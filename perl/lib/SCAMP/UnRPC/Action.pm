package UnRPC::Action;

use Moose;
use namespace::autoclean;

has name     => (is => 'ro', required => 1);
has invocant => (is => 'ro', required => 1);
has coderef  => (is => 'ro', isa => 'CodeRef', required => 1);
has flags    => (is => 'ro', isa => 'HashRef', required => 1);
has version  => (is => 'ro', isa => 'Int', default => 1);
has method   => (is => 'ro', isa => 'Maybe[Class::MOP::Method]', default => undef);
has timeout  => (is => 'ro', isa => 'Maybe[Int]', default => undef);

sub call {
    my $self = shift;
    $self->{coderef}->( $self->{invocant}, @_ );
}

__PACKAGE__->meta->make_immutable;
