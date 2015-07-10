package SCAMP::Worker::Process;

use Moose;
use namespace::autoclean;

use SCAMP::Worker::LowLevel;
use SCAMP::Worker::Request;
use SCAMP::Stream;
use Encode;
use JSON;
use Scalar::Util 'weaken';
use Try::Tiny;
use SCAMP::Logger tag => 'process';

use constant {
    UNSTARTED => 'UNSTARTED',
    IDLE      => 'IDLE',
    BUSY      => 'BUSY',
    DONE      => 'DONE',
    DEAD      => 'DEAD',
    REAPED    => 'REAPED',
};

has handler => (is => 'ro', isa => 'CodeRef', required => 1);
has request_class => (is => 'ro', isa => 'ClassName', default => 'SCAMP::Worker::Request');

has on_state_change => (is => 'ro', isa => 'CodeRef', required => 1);

has _ll => (is => 'ro', isa => 'SCAMP::Worker::LowLevel', init_arg => undef, handles => [qw[ kill pid ]]);

has state  => (is => 'rw', isa => 'Str', default => UNSTARTED, init_arg => undef, writer => '_state', trigger => sub { goto &{ $_[0]->on_state_change } });

has config  => ( is => 'ro', isa => 'SCAMP::Config', required => 1 );

has _max_inflight => (is => 'ro', init_arg => undef, lazy => 1, default => sub { shift->config->get('flow.max_inflight', 65536) });

# next three only valid during BUSY
has _response    => (is => 'rw', isa => 'SCAMP::Stream', clearer => '_clear_response', init_arg => undef);
has _on_response => (is => 'rw', isa => 'CodeRef',        clearer => '_clear_on_response', init_arg => undef);
has _request     => (is => 'rw', isa => 'SCAMP::Stream', clearer => '_clear_request', init_arg => undef);

has _shutdown_request => (is => 'rw', isa => 'Bool', init_arg => undef, default => 0);

has _timeout_watcher  => (is => 'bare', init_arg => undef);

sub start {
    my ($self, $fun) = @_; @_ = ();

    confess "start is only allowed in UNSTARTED state, this is $self->state" if $self->state ne UNSTARTED;

    weaken $self;
    $self->{_ll} = SCAMP::Worker::LowLevel->fork(
        worker    => sub { $fun->(); $self->_worker(@_) },
        on_packet => sub { $self->_on_packet(@_) if $self },
        on_died   => sub { $self->_on_died(@_) if $self },
        on_reap   => sub { $self->_state(REAPED) if $self },
        config    => $self->config,
    );
    logdebug("starting worker ${\$self->pid}");
    $self->_state(IDLE);
}

sub _post_fork {
    my ($self) = @_;
    %$self = ( request_class => $self->{request_class}, config => $self->{config}, handler => $self->{handler} ); #everything else can go
}

sub _on_packet {
    my ($self, $tag, $body) = @_;

    if ($tag eq 'shutdown') {
        if ($self->state eq BUSY) {
            $self->_shutdown_request(1);
        } else {
            $self->kill;
        }
        return;
    }

    if ($self->state ne BUSY) {
        return $self->kill("Received packet in state ${\$self->state}");
    }

    if ($tag eq 'timeout') {
        my $timeout = int($body);
        return $self->kill("Bogus timeout $timeout") if $timeout <= 0 || $timeout > 86400 || $timeout != $timeout;
        logdebug("Timeout override",{pid => $self->pid, timeout => $timeout});
        $self->_set_timeout( $timeout );
        return;
    }

    if ($tag eq 'header') {
        my $header;
        try {
            $header = decode_json $body;
        };
        if (!$header && ref($header) ne 'HASH') {
            return $self->kill("Received bogus header from worker");
        }
        if ($self->_response) {
            return $self->kill("Received header with a current response");
        }
        my $resp = SCAMP::Stream->new( header => $header );
        weaken $self;
        my $weakresp = $resp;
        weaken $weakresp;
        $resp->on_ack(sub {
            return unless $self && $weakresp;
            if ($weakresp->pointer - $weakresp->acknowledged < $self->_max_inflight) {
                $self->_ll->start_read;
            }
        });
        $self->_response( $resp );
        
        try{
            $self->_on_response->( $resp );
        }catch {
            logcritical("Unhandled exception calling _on_response: $_");
        };
        
        $self->_clear_on_response;
        return;
    }

    if ($tag eq 'data') {
        if (! $self->_response) {
            return $self->kill("Received data with no current response");
        }
        $self->_response->add_data( $body );
        if ($self->_response->pointer - $self->_response->acknowledged >= $self->_max_inflight) {
            # it would be possible to add an additional buffer to avoid the temporary oversend.  punt.
            $self->_ll->stop_read;
        }
        return;
    }

    if ($tag eq 'dataend' || $tag eq 'exception') {
        if (!$self->_response) {
            return $self->kill("Ended data without first starting it");
        }
        $self->_response->finish( $tag eq 'dataend' ? undef : Encode::decode_utf8($body) );
        $self->_clear_response;
        $self->_clear_request;
        $self->_clear_on_response;
        $self->{_timeout_watcher} = undef;
        if ($self->_shutdown_request) {
            $self->_state(DONE);
            $self->kill("Shutdown requested by worker");
        } else {
            $self->_state(IDLE);
        }
        return;
    }

    $self->kill("Unhandled packet type $tag");
}

sub _set_timeout {
    my ($self, $timeout) = @_;
    weaken $self;
    $self->{_timeout_watcher} = EV::timer($timeout, 0, sub {
        $self->kill("Worker exceeded timeout") if $self;
    });
}

sub _on_died {
    my ($self, @err) = @_;

    if ($self->state eq BUSY) {
        logerror("Worker died mid request -", @err);
        my $err = @err ? join(' ', 'Worker protocol error:', @err) : 'Worker died unexpectedly';
        if ($self->_response) {
            $self->_response->finish( $err );
        } else {
            $self->_on_response->( SCAMP::Stream->new( header => {}, error => $err ) );
        }
    }

    $self->_state(DEAD);
}

sub assign {
    my ($self, $req, $on_resp) = @_;
    weaken $self;

    confess "Can only assign to IDLE workers, this is ${\$self->state}" if $self->state ne IDLE;

    $self->_state(BUSY);
    $self->_ll->send_packet('header', encode_json($req->header));
    $self->_request($req);
    $self->_on_response($on_resp);
    $self->_set_timeout( $self->config->get('worker.timeout', 60) );

    weaken $req;
    $req->on_some_data(
        sub {
            return unless $self;
            my $data = shift;
            $self->_ll->send_packet('data', $data, sub { $req->ack( length $data ) if $req });
        },
        sub {
            return unless $self;
            my $msg = shift;
            if (defined $msg->error) {
                $self->_ll->send_packet('exception', Encode::encode_utf8($msg->error));
            } else {
                $self->_ll->send_packet('dataend', '');
            }
        },
    );
}

# begin child stuff {{{

sub _worker {
    my ($self, $recv, $send) = @_;

    my $requests = 0;
    my $max_requests = $self->config->get('worker.max_requests', 100);

    while (1) {
        my ($tag1, $body1) = $recv->();

        if ($tag1 ne 'header') {
            logerror("Phase error - request cycle began with $tag1");
            return;
        }

        my $header;
        try {
            $header = decode_json $body1;
        };
        if (!$header || ref($header) ne 'HASH') {
            logerror("Request header was not a valid JSON HASH");
            return;
        }

        my $rq = $self->request_class->new( _send_func => $send, _recv_func => $recv,
            request_header => $header );

        my $error;
        try {
            $self->handler->($rq);
        } catch {
            logerror('Unknown child error -', $_ );
            $error = $_ || 'Unknown error'; # guard against $@ clobbering
        };
        $rq->end_of_response( $error );

        $send->('shutdown','') if ++$requests >= $max_requests;
    }
}

# }}}

__PACKAGE__->meta->make_immutable;
__END__

=head1 NAME

SCAMP::Worker - fork children and make them do the work

=head1 SYNOPSIS

    my $worker = SCAMP::Worker->new(
        on_state_change => sub { my ($w, $new, $old) = @_; ... },
        handler         => sub { my ($req) = @_; ... },
    );

    $worker->start;
    $worker->assign($request, $on_reply);

=head1 DESCRIPTION

SCAMP::Worker manages a single child process, creating it, monitoring its
status, and allowing requests to be delegated to it.

A SCAMP::Worker object can be in one of four states, identified by
package-scope string (use eq) constants:

=over 4

=item UNSTARTED

The object has been created but not yet started.

=item IDLE

The process exists and is waiting for a request.  L<assign|/"assign($request, $on_reply)"> can be
called in this state, and the process can be killed without data loss.

=item BUSY

The process is currently handling a request.

=item DEAD

The process has exited.

=item REAPED

The process no longer exists.

=back

When a process transitions from one state to another, on_state_change is called
as a Moose trigger, see L<Moose::Manual::Attributes|Moose::Manual::Attributes/Triggers>
for details.

=head1 ATTRIBUTES

=head2 handler

A coderef which is invoked with a L<SCAMP::Worker::Request|SCAMP::Worker::Request>
or subclass object when a request is assigned to the worker.

=head2 request_class

If set, this specifies a subclass of request object to use.

=head2 on_state_change

See L<DESCRIPTION|/DESCRIPTION>.

=head2 state

Returns the current process state.

=head1 METHODS

=head2 start($cb)

Call this when a worker is UNSTARTED before using it.  C<$cb> will be called
with no arguments in the forked child.

=head2 assign($request, $on_reply)

Call this when a worker is IDLE to give it a request.  C<$on_reply> will be
passed a reply Message when done.
