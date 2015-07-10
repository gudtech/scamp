package SCAMP::Transport::ConnectionManager;

use Moose;
use namespace::autoclean;

use URI;
use Scalar::Util qw(weaken);
use SCAMP::Transport::SCAMP::Client;

has _open   => (is => 'bare', isa => 'HashRef', default => sub { {} });

my %CLASSES = ( 'scamp+tls' => 'SCAMP::Transport::SCAMP::Client' );

sub get {
    my ($self, $svc) = @_;
    my $uri = $svc->address;
    return $self->{_open}{$uri} if $self->{_open}{$uri};

    my $scheme = URI->new($uri)->scheme;

    my $class = $CLASSES{$scheme} or return undef;

    weaken $self;
    return $self->{_open}{$uri} = $class->new(
        uri => $uri, fingerprint => $svc->fingerprint,
        on_lost => sub { delete $self->{_open}{$uri} if $self }
    );
}

__PACKAGE__->meta->make_immutable;
