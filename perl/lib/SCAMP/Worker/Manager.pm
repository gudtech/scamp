package SCAMP::Worker::Manager;

use Moose;
use namespace::autoclean;
use Scalar::Util qw( weaken );

use List::Util 'min';
use SCAMP::Worker::Process;
use SCAMP::Worker::ShutdownManager;
use SCAMP::Logger tag => 'worker-mgr';
use EV;

has handler => (is => 'ro', isa => 'CodeRef',       required => 1);
has shutdown => (
                 is => 'ro', isa => 'SCAMP::Worker::ShutdownManager',
                 required => 1,
                 default => sub { SCAMP::Worker::ShutdownManager->new }
                );

has _ratelimit_timer => (is => 'bare', init_arg => undef);
has _idle_respawn    => (is => 'bare', init_arg => undef);
has _workers         => (is => 'bare', init_arg => undef, default => sub { [ ] });
has _request_queue   => (is => 'bare', init_arg => undef, default => sub { [ ] });

has _shutdown_wait_timer => (is => 'bare', init_arg => undef);
has _shutdown_mode       => (is => 'bare', init_arg => undef);
has config               => (is => 'ro', isa => 'SCAMP::Config', required => 1);

sub _check_respawn {
    my ($self) = @_;

    if ($self->{_ratelimit_timer}) {
        # respawned in the last second, don't do anything until a second has passed
        return;
    }
    return if $self->{_shutdown_mode};

    my $workers = $self->{_workers};
    my $spare = 0;
    my $did_work;
    
    my $worker_limit = $self->config->get('worker.limit', 8);
    my $min_spares   = min int($worker_limit) - 1, $self->config->get('worker.min_spares', 2);

    for (@$workers) { $spare++ if $_->state eq SCAMP::Worker::Process::IDLE }
    logdebug("check_respawn", { idle => $spare, total => scalar @$workers });

    if ($spare > 1 && $spare > $self->config->get('worker.max_spares', 4)) {
        # kill the last-spawned / lowest-prio spare worker

        my ($victim) = grep { $_->state eq SCAMP::Worker::Process::IDLE } reverse @$workers;

        $victim->kill("worker_max_spares violated");
        $did_work = 1;
    }
    elsif (@$workers < $worker_limit && $spare < $min_spares) {
        # start a new one
        logdebug("starting new");
        $self->_start_a_worker;
        $did_work = 1;
    }

    if ($did_work) {
        weaken $self;
        $self->{_ratelimit_timer} = EV::timer 1, 0, sub {
            return unless $self && %$self;
            delete $self->{_ratelimit_timer};
            logdebug("Rate limit timer expired");
            $self->_check_respawn;
        };
    }
}

sub _worker_state_changed {
    my ($self, $worker, $new) = @_;

    logdebug("Worker state changed", { pid => $worker->pid||0, state => $new });
    if ($new eq SCAMP::Worker::Process::REAPED) {
        # remove from the pool.
        @{ $self->{_workers} } = grep { $_ != $worker } @{ $self->{_workers} };

        $self->shutdown->unblock_shutdown if $self->{_shutdown_mode} && @{ $self->{_workers} } == 0;
    }
    elsif ($new eq SCAMP::Worker::Process::IDLE) {
        if ($self->{_shutdown_mode}) {
            # when we're shutting down, workers quit when idle
            $worker->kill("Shutting down");
            return;
        }

        # dispatch a request from the queue
        my $rpacket = shift @{ $self->{_request_queue} };
        if ($rpacket) {
            logdebug("Assigning queued request");
            $worker->assign( @$rpacket );
        }
    }

    $self->_check_respawn_later;
}

sub _check_respawn_later {
    my ($self) = @_;

    weaken $self;
    $self->{_idle_respawn} ||= EV::idle sub {
        return unless $self && %$self;
        logdebug("idle_respawn $self");

        # ordinarily it would be enough to just delete, but we're about to fork and in the forked process, we're permanently in the scope of this event handler,
        # holding on to the watcher.
        $self->{_idle_respawn}->stop; @_ = ();

        delete $self->{_idle_respawn};
        $self->_check_respawn; # should only be called close to the event loop
    };
}

sub _start_a_worker {
    my ($self) = @_;
    weaken $self;

    return if @{ $self->{_workers} } >= $self->config->get('worker.limit', 8);

    push @{ $self->{_workers} }, SCAMP::Worker::Process->new(
        handler         => $self->handler,
        on_state_change => sub { $self->_worker_state_changed(@_) if $self && %$self },
        config          => $self->config
    );

    $self->shutdown->block_signals;
    $self->{_workers}->[-1]->start( sub { $self->shutdown->post_fork; } );
    $self->shutdown->unblock_signals;
}

sub queue_request {
    my ($self, $request, $on_reply) = @_;

    my ($assignee) = grep { $_->state eq SCAMP::Worker::Process::IDLE } @{ $self->{_workers} };

    if ($assignee) {
        logdebug("Assigning request immediately to",$assignee->pid);
        $assignee->assign( $request, $on_reply );
    } else {
        # we'll get to it when there is an idle worker
        logdebug("Queueing request");
        push @{ $self->{_request_queue} }, [ $request, $on_reply ];
    }
    return;
}

sub BUILD {
    my $self = shift;

    weaken $self;
    $self->shutdown->on_before_shutdown(sub {
        return unless $self;

        $self->shutdown->block_shutdown;
        $self->{_pre_shutdown} = EV::timer 2, 0, sub {
            return unless $self;
            $self->{_shutdown_mode} = 1;

            my @workers = @{ $self->{_workers} }; # guard against concurrent modification

            if(@workers > 0){ # was failing to shut down under some circumstances when all workers died due to crashes
                logdebug("Waiting for workers to complete");

                for my $w (@workers) {
                    $w->kill("Shutting down") if $w->state eq SCAMP::Worker::Process::IDLE;
                }
            }
            else {
                $self->shutdown->unblock_shutdown;
            }
        };
    });

    $self->shutdown->on_fork(sub {
        return unless $self;
        for (@{ $self->{_workers} }) { $_->_post_fork }
        %$self = ();
    });
}

sub prime {
    my $self = shift;
    $self->_check_respawn_later;
}

__PACKAGE__->meta->make_immutable;
__END__

=head1 NAME

SCAMP::Worker::Manager - intelligent worker management

=head1 SYNOPSIS

    my $manager = SCAMP::Worker::Manager->new( handler => \&my_handler );

    $manager->queue_request( $rq, $on_reply )

=head1 DESCRIPTION

SCAMP::Worker::Manager maintains a pool of L<SCAMP::Worker::Process|SCAMP::Worker::Process>
instances.  It automatically creates and kills worker processes to keep the counts of
idle and total worker processes within configured limits, even as loads change and
workers terminate (due to crashes or configured request limits).  Whenever
the manager creates or kills a worker, it waits one second before doing
another operation.

For configuration options, see worker_max_spares, worker_min_spares,
worker_start, and worker_limit in L<SCAMP::Config|SCAMP::Config>.

=head1 ATTRIBUTES

See the L<SCAMP::Worker::Process|SCAMP::Worker::Process> documentation.  handler is passed through.
