package UnRPC::Base;
use Moose;
use Carp;
use namespace::autoclean;

extends 'MooseX::MethodAttributes::Inheritable';

__PACKAGE__->meta->make_immutable;

my %versions;
my %namespaces;

sub _scamp_version {
    my ($pkg, $version) = @_;
    $version =~ /^\d+$/ or croak "non-positive-integer version";
    $versions{ $pkg } = $version;
}

sub _scamp_namespace {
    my ($pkg, $ns) = @_;
    $ns =~ /^\w+(?:\.\w+)*$/ or croak "invalid namespace syntax";
    $namespaces{ $pkg } = $ns;
}

sub _scamp_get_defaults {
    return $namespaces{ $_[0] }, $versions{ $_[0] };
}
1;
