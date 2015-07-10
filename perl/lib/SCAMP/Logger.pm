package SCAMP::Logger;

use Moose;
use DateTime;
use namespace::autoclean;
use IO::Handle;

our $REDIRECT;

my %config = (tag => 'unconfigured');
my $logfile;
my @logbuf;
my $childmode;

sub _common {
    my ($severity, $pkg, @args) = @_;

    return $REDIRECT->($severity, "@args") if $REDIRECT;

    return if $severity eq 'debug' && !$config{debug}; # shortcircuit

    my $date = DateTime->now->iso8601;
    my $line = "$date\t$config{tag}\t$$\t$severity\t@args\n";

    if ($severity eq 'error' || $severity eq 'fatal' || $config{debug}) {
        print STDERR $line;
    }
    if ($severity ne 'debug') {
        if ($logfile) {
            print $logfile $line;
        } else {
            push @logbuf, $line;
        }
    }
    if ($severity eq 'fatal') {
        die $line if $childmode;
        exit 1;
    }
}

sub debug { _common('debug', @_) }
sub info  { _common('info',  @_) }
sub error { _common('error', @_) }
sub fatal { _common('fatal', @_) }

sub configure {
    my ($pkg, $params) = @_;

    $config{tag} = $params->{tag};
    $config{debug} = $params->{debug};

    $pkg->fatal("tag required") unless $params->{tag};

    my $logpath = SCAMP::Config->val($params->{tag} . '.logfile', "/var/log/SCAMP/$params->{defname}.log");
    open $logfile, '>>', $logpath or $pkg->fatal("cannot open log file $logpath: $!\n");

    $logfile->autoflush(1);
    print $logfile $_ for splice @logbuf;

    $pkg->info('Log opened');
}

sub child_mode {
    $childmode = 1;
    $config{tag} .= '/child';
}

sub get_file { $logfile }

__PACKAGE__->meta->make_immutable;
