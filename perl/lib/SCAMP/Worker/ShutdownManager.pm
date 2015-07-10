package SCAMP::Worker::ShutdownManager;

use Moose;
use namespace::autoclean;
use Scalar::Util qw( weaken );
use POSIX qw( SIGHUP SIGINT SIGTERM SIGQUIT sigprocmask SIG_BLOCK SIG_UNBLOCK );
use SCAMP::Logger;

use AE;

our %sigkill_watchers;

has signals => (isa => 'ArrayRef', is => 'ro', default => sub { [ SIGINT, SIGQUIT, SIGTERM, SIGHUP ] }, auto_deref => 1);

has _before_shutdown_queue => ( is => 'bare', init_arg => undef, default => sub { [] } );
has _shutdown_queue => ( is => 'bare', init_arg => undef, default => sub { [] } );
has _fork_queue => ( is => 'bare', init_arg => undef, default => sub { [] } );

has _shutdown_block_count => (is => 'bare', isa => 'Int', default => 1, init_arg => undef);

has _shutdown_signal => (is => 'bare', isa => 'Str', init_arg => undef);
has _signal_watchers => (is => 'bare', isa => 'HashRef', init_arg => undef);

sub on_before_shutdown { push @{ $_[0]{_before_shutdown_queue} }, $_[1] }
sub on_shutdown { push @{ $_[0]{_shutdown_queue} }, $_[1] }
sub on_fork { push @{ $_[0]{_fork_queue} }, $_[1] }

sub block_shutdown {
    my $self = shift;
    logdebug(scalar(caller), "blocked shutdown");
    $self->{_shutdown_block_count}++;
}

sub unblock_shutdown {
    my $self = shift;
    logdebug(scalar(caller), "unblocked shutdown", { block_count => $self->{_shutdown_block_count} - 1 });
    return if --$self->{_shutdown_block_count};

    loginfo("Beginning final shutdown ...");
    $_->() for @{ $self->{_shutdown_queue} };

    $self->{_signal_watchers}{ $self->{_shutdown_signal} }->stop;
    
    loginfo("Exiting");
    kill $self->{_shutdown_signal}, $$;
    exit 1; # should probably not get here in most cases
}

sub _start_shutdown {
    my ($self, $sig) = @_;
    if ($self->{_shutdown_signal}) {
        loginfo("Received signal $sig but shutdown already started.");
        return;
    }

    loginfo("Received signal $sig, shutting down ...");
    $self->{_shutdown_signal} = $sig;

    $_->() for @{ $self->{_before_shutdown_queue} };
    $self->unblock_shutdown;
}

sub BUILD {
    my ($self) = @_;
    weaken $self;

    $self->{_signal_watchers} = {};

    for my $signal ($self->signals) {
        $self->{_signal_watchers}{$signal} = AE::signal $signal, sub {
            $self->_start_shutdown($signal) if $self;
        };
    }
}

# XXX this is a big mess.  We need to remove the signal handlers in forked
# children so that the manager can terminate them, and we need to block
# signals to avoid races when the manager wants to kill a process it just
# started.
sub block_signals {
    my ($self) = @_;
    sigprocmask(SIG_BLOCK, POSIX::SigSet->new( $self->signals ));
}

sub unblock_signals {
    my ($self) = @_;
    sigprocmask(SIG_UNBLOCK, POSIX::SigSet->new( $self->signals ));
}

sub unhandle_signals {
    my ($self) = @_;
    for (values %{ $self->{_signal_watchers} }) { $_->stop }
    # the workers should still ignore terminal signals
    $SIG{INT} = $SIG{QUIT} = 'IGNORE';
}

sub post_fork {
    my ($self) = @_;

    $Devel::Trace::TRACE=1;
    $self->unhandle_signals;
    $self->unblock_signals;
    %sigkill_watchers = ();

    delete $self->{_before_shutdown_queue};
    delete $self->{_shutdown_queue};

    $_->() for @{ $self->{_fork_queue} };

    EV::now_update;
    # make sure that all of the parent process EV watchers got removed
    my $killer = EV::timer 0.1, 0, sub {
        logcritical("One or more EV timers are still installer");
        POSIX::_exit(1); # don't call DESTROY or END subs, that would only make things worse e.g. corrupting SSL protocol state
    };
    $killer->keepalive(0);
    # if there are no other timers, EV::run will return immediately
    EV::run;
    undef $killer;
}


sub schedule_sigkill {
    my ($pkg, $when, $pid) = @_;
    return unless $pid;

    # this looks racy, but it isn't.  when the child dies naturally, it sticks
    # around as a zombie preventing the PID from being reused until libev calls
    # waitpid().  but after the waitpid(), libev immediately signals the child
    # watcher and sets it to MAXPRI, so even if the timer is pending, the child
    # watcher is guaranteed to be run first (and cancel the timer).

    my $hash;
    $hash = {
        c => EV::child($pid, 0, sub {
            delete $sigkill_watchers{$hash} if $hash; # removes timeout handler
        }),
        t => EV::timer($when, 0, sub {
            loginfo("Sending KILL",{pid => $pid});
            kill KILL => $pid;
        }),
    };

    $sigkill_watchers{$hash} = $hash;
    weaken $hash;
    return;
}

__PACKAGE__->meta->make_immutable;
1;

