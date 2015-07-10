package SCAMP::Service;

use Moose;
use namespace::autoclean;
use Scalar::Util qw(weaken);

use File::Slurp;
use AnyEvent::TLS;
use Getopt::Long;
use Proc::Daemon;
use EV;

use SCAMP::Config;
use SCAMP::Logger;
use SCAMP::Transport::SCAMP::Server;
use SCAMP::Discovery::Announcer;

use SCAMP::Config;
use SCAMP::Worker::Manager;
use SCAMP::Worker::ShutdownManager;

use UnRPC::Discovery;
use UnRPC::Documentation;
use UnRPC;

has name      => (is => 'ro', isa => 'Str', required => 1);
has sector    => (is => 'ro', isa => 'Str', default => 'main');
has prefix    => (is => 'ro', isa => 'Str', required => 1);
has envelopes => (is => 'ro', isa => 'ArrayRef[Str]', default => sub { ['json', 'jsonstore', 'extdirect'] });

has prefork   => (is => 'ro', isa => 'CodeRef');
has preinvoke => (is => 'ro', isa => 'CodeRef');
has endinvoke => (is => 'ro', isa => 'CodeRef');

has shutdown => (is => 'ro', isa => 'SCAMP::Worker::ShutdownManager', lazy_build => 1);
sub _build_shutdown { SCAMP::Worker::ShutdownManager->new }

has config => (is => 'ro', isa => 'SCAMP::Config', lazy_build => 1);
sub _build_config { SCAMP::Config->new( name => 'soa' ) } # TODO

has unrpc => (is => 'ro', isa => 'UnRPC', lazy_build => 1);

sub _build_unrpc {
    my $self = shift;
    my $discovery = UnRPC::Discovery->new;
    $discovery->discover( $self->prefix );
    UnRPC::Documentation->new( owner => $discovery );
    UnRPC->new(
        discovery => $discovery,
        ($self->preinvoke ? (preinvoke => $self->preinvoke) : ()),
        ($self->endinvoke ? (endinvoke => $self->endinvoke) : ()),
    );
}

has manager => (is => 'ro', isa => 'SCAMP::Worker::Manager', lazy_build => 1);

sub _build_manager {
    my $self = shift;
    weaken $self;
    $self->unrpc; # don't run this in a forked child
    $self->shutdown->on_fork(sub {
        undef $self->{manager};
        undef $self->{server};
        undef $self->{announcer};
        # need to keep unrpc though
    });
    SCAMP::Worker::Manager->new(
        config   => $self->config,
        shutdown => $self->shutdown,
        handler  => sub { $self->unrpc->service( $_[0] ) if $self },
    );
}

has server => (is => 'ro', isa => 'SCAMP::Transport::SCAMP::Server', lazy_build => 1);

sub _build_server {
    my $self = shift;

    my $ctx = AnyEvent::TLS->new(
        key_file  => SCAMP::Config->val($self->name . '.soa_key'),
        cert_file => SCAMP::Config->val($self->name . '.soa_cert'),
    );

    weaken $self;
    SCAMP::Transport::SCAMP::Server->new(
        tls_ctx  => $ctx,
        callback => sub { $self->manager->queue_request(@_) if $self },
    );
}

has announcer => (is => 'ro', isa => 'SCAMP::Discovery::Announcer', lazy_build => 1);

sub _build_announcer {
    my $self = shift;

    my $ann = SCAMP::Discovery::Announcer->new(
        address   => $self->server->server_uri,
        envelopes => $self->envelopes,
        actions   => [
            $self->unrpc->announce_data,
        ],
        sector    => $self->_sector,

        sign_pem => scalar (read_file(SCAMP::Config->val($self->name . '.soa_key'))),
        cert_pem => scalar (read_file(SCAMP::Config->val($self->name . '.soa_cert'))),
        name => $self->name,
    );

    weaken $self;
    $self->shutdown->on_before_shutdown(sub {
        $self->shutdown->block_shutdown;
        $ann->shutdown(sub { $self->shutdown->unblock_shutdown });
    });

    $ann;
}

sub _sector { $_[0]->sector }

sub start {
    my $self = shift;

    my @overrides;
    my $debug;
    my $foreground;
    my $nproc;
    my $pidfile;

    GetOptions(
        'd|debug',      \$debug,
        'f|foreground', \$foreground,
        'nproc=i',      \$nproc,
        'pidfile=s',    \$pidfile,
        'conf-override|O=s', \@overrides
    ) or die <<HELP ;
Available options to the Perl service harness are:

    -d --debug          Do not fork, verbosely log to STDOUT
    -f --foreground     Do not fork, but be quiet about it
       --nproc=N        Limit to N processes
       --pidfile=PATH   Write a pidfile
    -O --conf-override foo=bar
                        Override a configuration option
HELP

    SCAMP::Logger->configure({ tag => $self->name, defname => "service-" . $self->name, debug => $debug });
    SCAMP::Logger::set_max_prio('info') if $foreground;
    $EV::DIED = sub { SCAMP::Logger->error('Uncaught exception in event handler',$@) };

    $self->prefork->() if $self->prefork;
    die "Pidfile required when not foreground\n" if !$pidfile && !$debug && !$foreground;

    if ($pidfile) {
        my $errf = SCAMP::Config->val($self->name . '.stderr', "/var/log/scamp/service-".$self->name."-stderr.log");
        open STDOUT, ">>", $errf
            or die "Cannot open error file ($errf): $!\n";
        open STDERR, ">&STDOUT" or die "Cannot dup stdout to stderr: $!\n";

        select STDERR; $| = 1;
        select STDOUT; $| = 1;
    }

    Proc::Daemon::Init({
        pid_file => $pidfile, dont_close_fh => [ SCAMP::Logger->get_file, \*STDERR, \*STDOUT ],
    }) if $pidfile;

    # now that we're daemonized errors won't show up, so make sure they are logged
    try {
        # stab EV and make it notice right away that its event loop is closed
        EV::run EV::RUN_NOWAIT;

        SCAMP::Config->set_override( 'worker.limit', $nproc ) if $nproc;

        for my $o (@overrides) {
            $o =~ /^(.*?)=(.*)$/ or die "Override missing equals sign: $o\n";
            SCAMP::Config->set_override( $1, $2 );
            $self->config->set($1,$2);
        }

        $self->server;
        $self->announcer;
        $self->prefork->() if $self->prefork; #unrpc loaded stuff
        $self->manager;
        $self->prefork->() if $self->prefork;

        $self->manager->prime;
        EV::run;
    } catch {
        SCAMP::Logger->error("Unhandled exception $_");
    };
}

__PACKAGE__->meta->make_immutable;
