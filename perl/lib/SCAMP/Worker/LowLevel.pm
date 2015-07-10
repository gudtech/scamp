package SCAMP::Worker::LowLevel;

use Moose;
use namespace::autoclean;
use EV;
use Scalar::Util 'weaken';

use IO::Handle;

use SCAMP::Exception;
use SCAMP::Logger tag => 'lowlevel';
use POSIX qw( EAGAIN _exit );

has cmd_write => (is => 'ro', isa => 'FileHandle', required => 1);
has rpy_read  => (is => 'ro', isa => 'FileHandle', required => 1);
has pid       => (is => 'ro', isa => 'Int',        required => 1);
has on_packet => (is => 'ro', isa => 'CodeRef',    required => 1);
has on_died   => (is => 'ro', isa => 'CodeRef',    required => 1);
has on_reap   => (is => 'ro', isa => 'CodeRef',    required => 1);
has config    => (is => 'ro', isa => 'SCAMP::Config', required => 1);

has dead      => (is => 'ro', isa => 'Bool', init_arg => undef, default => 0);

has _child_watcher => (is => 'bare', init_arg => undef);
has _read_watcher  => (is => 'bare', init_arg => undef);
has _write_watcher => (is => 'bare', init_arg => undef);
has _write_queue   => (is => 'bare', init_arg => undef);
has _read_queue    => (is => 'bare', init_arg => undef);

# TODO: use of strings as queues is bound to become unperformant once they reach a certain length.

sub BUILD {
    my $self = shift;
    weaken $self;

    $self->{_read_queue} = '';
    $self->{_write_queue} = [];

    $self->{_child_watcher} = EV::child $self->pid, 0, sub { $self->_died if $self };
    $self->{_read_watcher}  = EV::io $self->rpy_read, EV::READ, sub { $self->_read_cycle if $self };

    $self->{_write_watcher} = EV::io_ns $self->cmd_write, EV::WRITE, sub {
        return unless $self;
        my $q = $self->{_write_queue};
        nonblock: {
            if (!@$q) {
                $self->{_write_watcher}->stop;
                return;
            }
            elsif (ref $q->[0]) {
                shift(@$q)->();
                redo;
            }
            elsif ($q->[0] eq '') {
                shift @$q;
                redo;
            }
            else {
                my $str = \($q->[0]);
                my $written = syswrite $self->cmd_write, $$str;
                if ($written) {
                    substr($$str, 0, $written) = '';
                    redo;
                } elsif (!defined($written) && $! != EAGAIN) {
                    return $self->kill("Failed to write to command pipe",$!);
                } else {
                    return; # wrote nothing
                }
            }
        }
    };
}

sub _read_cycle {
    my $self = shift;
    # on_packet -> add_data -> ack -> start_read -> _read_cycle
    return if $self->{_in_read_cycle};
    local $self->{_in_read_cycle} = 1;
    cycle: while (1) {
        cmd: {
            last unless $self->{_read_queue} =~ /^(\w+) (\d+)\n/;
            my $prefix = length($1) + length($2) + 2;
            last unless length($self->{_read_queue}) >= $prefix + $2;

            $self->on_packet->($1, substr($self->{_read_queue}, $prefix, $2));
            substr($self->{_read_queue}, 0, $prefix + $2) = '';

            last cycle if !$self->{_read_watcher} || !$self->{_read_watcher}->is_active;
            redo cycle;
        }
        # no command?  maybe we can read one
        my $read = sysread $self->rpy_read, $self->{_read_queue}, 32768, length $self->{_read_queue};
        if (!defined $read) {
            last cycle if $! == EAGAIN;
            return $self->kill("Failed to read from reply pipe",$!);
        }
        if ($read == 0) {
            return $self->kill("EOF on reply pipe");
        }
    }
}

sub stop_read { $_[0]{_read_watcher}->stop; }
sub start_read { $_[0]{_read_watcher}->start; $_[0]->_read_cycle; }

sub _died {
    my ($self) = @_;
    logdebug($self->pid, ':', 'Exited');
    $self->{pid} = undef;

    $self->{_child_watcher} = $self->{_read_watcher} = $self->{_write_watcher} = undef;
    unless ($self->{dead}) { # kill() already did cleanup
        $self->{dead} = 1;
        $self->on_died->();
    }

    $self->on_reap->();
}

sub kill {
    my ($self, @bits) = @_;
    logdebug($self->pid, ':', @bits);

    return if $self->{dead}; # called twice?

    logdebug("Sending TERM to ${\$self->pid}");
    kill TERM => $self->pid;

    # delegate the delayed KILL to the process state to avoid a watcher leak that would trip the watcher test
    SCAMP::Worker::ShutdownManager->schedule_sigkill(
        $self->config->get('worker.kill_delay', 2),
        $self->pid
    );

    # do cleanup now
    $self->{dead} = 1;
    $self->on_died->(@bits);
    $self->{_read_watcher} = $self->{_write_watcher} = undef;
}

sub send_packet {
    my ($self, $tag, $data, $cb) = @_;

    $tag =~ /^\w+$/ or confess "bad tag format";
    $self->dead and return;

    push @{ $self->{_write_queue} }, "$tag " . length($data) . "\n$data";
    push @{ $self->{_write_queue} }, $cb if ref($cb) eq 'CODE';
    $self->{_write_watcher}->start if $self->{_write_watcher};
}

sub fork {
    my ($self, %args) = @_; @_ = ();

    my $worker    = delete $args{worker}    or confess "worker is required";
    my $on_packet = delete $args{on_packet} or confess "on_packet is required";

    pipe my $cmd_read, my $cmd_write or throw "pipe", "failed to open pipe: $!";
    pipe my $rpy_read, my $rpy_write or throw "pipe", "failed to open pipe: $!";

    $cmd_write->autoflush;
    $rpy_write->autoflush;
    $cmd_write->blocking(0);
    $rpy_read->blocking(0);

    my $pid = CORE::fork;
    defined($pid) or logcritical( "cannot fork: $!" );

    if ($pid == 0) {
        close $rpy_read;
        close $cmd_write;
        srand();

        undef $self;
        undef $on_packet;
        %args = ();
        $worker->(
            sub {
                my $hdr = readline $cmd_read;
                defined($hdr)                  or throw "header", "cannot read command: $!";
                $hdr =~ /^(\w+) (\d+)\n$/      or throw "parse", "cannot parse command header: $hdr";
                my $buf = '';
                while (length($buf) < $2) {
                    defined(read $cmd_read, $buf, $2 - length($buf)) or throw "body", "cannot read command body: $!";
                }
                logdebug("Worker received", $1, $buf);
                return ($1, $buf);
            },
            sub {
                my ($tag, $body) = @_;
                #logdebug("Worker sent", $tag, $body);
                print $rpy_write "$tag ", length($body), "\n$body";
            },
        );
        _exit 0;
    }

    return $self->new(
        on_died   => $args{on_died},
        on_reap   => $args{on_reap},
        on_packet => $on_packet,
        pid       => $pid,
        rpy_read  => $rpy_read,
        cmd_write => $cmd_write,
        config    => $args{config},
    );
}

__PACKAGE__->meta->make_immutable;
__END__

=head1 NAME

SCAMP::Worker::LowLevel - low-level I/O details for SCAMP::Worker

=head1 DESCRIPTION

This module implements some basic details of process
management - process life cycle tracking, forking,
and packetized I/O.

=head1 ATTRIBUTES

=head2 cmd_write

A filehandle reference to the command writing pipe.  Must be non-blocking.

=head2 rpy_read

A filehandle reference to the reply reading pipe.  Must be non-blocking.

=head2 pid

The PID of the worker process, or undef if it has already died and been reaped.

=head2 on_packet

A callback for chunks of data which are received on the reply pipe.  Called
from the event loop with the tag and byte content as separate arguments.

=head2 on_died

A callback which is called with message arguments when the worker process is
terminated (possibly before reaping).

=head2 on_reap

Called without arguments when the worker process is reaped.

=head2 dead

True if the worker has terminated.

=head1 METHODS

=head2 kill(@messages)

Terminates the worker by a TERM, wait, KILL sequence.  L<on_died|/on_died> will be
called immediately.  The wait period is configured by worker.kill_delay.  Takes
arguments indicating a kill reason, which are passed to on_died and to the logger.

=head2 send_packet($tag, $body, $cb)

Queues a packet to send to the worker, invoking $cb with no arguments after the
packet is entirely written.

=head2 start_read(), stop_read()

Turns on or off the reading of data from the reply pipe.

=head2 fork(on_packet => $cb1, on_died => $cb2, worker => $cb3, on_reap => $cb4)

Smart constructor.  Starts a new worker process and returns a
SCAMP::Worker::LowLevel object.  Arguments are attributes, except C<worker>
which is invoked in the forked child.  The worker receives two callback
arguments:

=over 4

=item $recv->()

Receives, blockingly, a packet from the parent process.  Returns the tag and
data block as two items in list context.

=item $send->($tag, $data)

Sends, blocking, a packet to the parent process.

=back

=head1 PROTOCOL

Packets sent to and from the child consist of a string tag which should match
C</^[a-z]+$/>, and an uninterpreted byte string of data.  They are encoded by
sending the tag, a space, the length of data in ASCII decimal, a newline, and
then the data.
