package SCAMP::Discovery::ServiceManager;

use Moose;
use namespace::autoclean;

use File::Slurp;
use Try::Tiny;

use SCAMP::Discovery::Observer;
use SCAMP::Discovery::ServiceInfo;
use SCAMP::Config;
use SCAMP::Logger;

has services     => (is => 'ro', isa => 'HashRef', default => sub { { } });
has _timestamps  => (is => 'ro', isa => 'HashRef', default => sub { { } });
has _expirations => (is => 'ro', isa => 'HashRef', default => sub { { } });
has sector       => (is => 'rw', isa => 'Str', default => 'main');

has _listener => (is => 'bare');
has _filled   => (is => 'bare');

sub inject {
    my ($self, $dynamic, $hint, $blob) = @_;

    try {
        my $info = SCAMP::Discovery::ServiceInfo->parse_announcement( $blob );
        my $key = $info->fingerprint . ' ' . $info->worker_ident;

        # prevent replay attacks
        if ($self->{_timestamps}{$key} && $info->timestamp < $self->{_timestamps}{$key}) {
            SCAMP::Logger->fatal('Timestamp '.$info->timestamp." is not the most recent for $key");
        }
        $self->{_timestamps}{$key} = $info->timestamp;

        $info->offerings;
        $info->expires( $dynamic ? (EV::now() + 2.1 * $info->send_interval) : 1e100 );
        $self->services->{$key} = $info;
        $self->{_expirations}{$key}
    } catch {
        SCAMP::Logger->error("Failed to parse announcement $hint : $_");
    };
}

sub lookup {
    my ($self, $action, $version, $envelope, $ident) = @_;

    my @cand;
    my $now = EV::now;
    for my $svk (keys %{ $self->services }) {
        my $sv = $self->{services}{$svk};
        if ($sv->expires < $now) {
            delete $self->{services}{$svk};
            next;
        }

        $sv->sector eq $self->sector or next;
        !$ident or $sv->worker_ident eq $ident or next;

        push @cand, $sv->can_do( $action, $version, $envelope );
    }

    return @cand ? $cand[ int rand @cand ] : undef;
}

sub fill_from_cache {
    my ($self) = @_;

    Carp::croak "already filled" if $self->{_filled}++;
    my $path  = SCAMP::Config->val('discovery.cache_path');
    my $limit = SCAMP::Config->val('discovery.cache_max_age', 120);
    my $age   = time - (stat $path)[9];

    SCAMP::Logger->fatal("Stale discovery cache") if $age > $limit;

    my $data = read_file $path;
    my ($header, @anns) = split /\n%%%\n/, $data;

    my $i = 1;
    for my $a (@anns) {
        $self->inject( 0, "[$i in discovery cache]", $a );
    }
}

sub listen {
    my ($self) = @_;

    Carp::croak "already filled" if $self->{_filled}++;
    $self->{_listener} = SCAMP::Discovery::Observer->new( manager => $self ); # return ref is weak
}

__PACKAGE__->meta->make_immutable;
