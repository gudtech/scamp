package SCAMP::Config;

use Net::Interface qw( AF_INET inet_ntoa );
use File::Slurp    qw( read_file );
use SCAMP::Logger;

use Moose;
use namespace::autoclean;

sub read_conf_file {
    my %used;
    my %ret;

    my $path = shift;
    my $conf = read_file($path, binmode => ':encoding(utf8)', array_ref => 1, chomp => 1, err_mode => 'carp') || [];

    for my $line (@$conf) {
        chomp $line;
        $line =~ s/^\s+//;
        $line =~ s/\s*#.*//;
        next if $line eq '';

        my ($lhs,$rhs) = split(/\s*=\s*/, $line, 2);

        unless (defined $rhs) {
            SCAMP::Logger->error("Config line has no equals: $line");
            next;
        }

        if ($used{$lhs}++) {
            SCAMP::Logger->error("Duplicate config variable, using first instance: $lhs");
            next;
        }

        $ret{$lhs} = $rhs;
    }
    %ret;
}

my %_values = read_conf_file($ENV{SCAMP} || '/etc/SCAMP/soa.conf');

sub set_override {
    my ($self, $var, $value) = @_;
    $_values{$var} = $value;
}

sub val {
    my ($self, $var, $deflt) = @_;

    if (exists $_values{$var}) {
        return $_values{$var};
    } elsif (defined $deflt) {
        return $deflt;
    } else {
        SCAMP::Logger->fatal("Config value $var is required");
    }
}

my $_interface_info;
sub _interface_info { $_interface_info ||= __PACKAGE__->_build_interface_info }
sub _build_interface_info {
    my ($self) = @_;

    my $info = {};

    for my $dev (Net::Interface->interfaces) {
        my $addr = $dev->address(AF_INET) or next;
        $addr = inet_ntoa($addr);

        $info->{$dev->name} = $addr;
        $info->{DEFAULT} = $addr if $addr =~ /^(?:10\.|192\.168\.)/;
    }

    $info;
}

sub _default_iflist {
    my ($self) = @_;
    [ $self->_interface_info->{DEFAULT} || SCAMP::Logger->fatal("No appropriate interface for probing bus.address; please set explicitly") ]
}

sub _parse_iflist {
    my ($self, $key) = @_;
    my $val = $self->val($key, '');
    $val =~ s/ //g;
    my @ifs;

    for my $chunk (grep { length } split /,/, $val) {
        my $addr;
        if ($chunk =~ /^if:(.*)/) {
            $val = $self->_interface_info->{$1};
        } elsif (grep { $_ eq $chunk } values %{ $self->_interface_info }) {
            $val = $chunk;
        }

        SCAMP::Logger->fatal("Could not resolve $chunk to an interface address") unless $val;
        push @ifs, $val;
    }

    @ifs ? (\@ifs) : undef;
}

sub bus_info {
    my $self = shift;
    my $common = $self->_parse_iflist('bus.address') || $self->_default_iflist;
    return {
        discovery => $self->_parse_iflist('discovery.address') || $common,
        service   => $self->_parse_iflist('service.address') || $common,
        port      => $self->val('discovery.port', 5555),
        group     => $self->val('discovery.multicast_address', '239.63.248.106'),
    };
}

__PACKAGE__->meta->make_immutable;

__END__

=head1 NAME

SCAMP::Config - config file parsing for SCAMP

=head1 SYNOPSIS

    say SCAMP::Config->var('cache.ping_interval', 120);

=head1 DESCRIPTION

This module implements reading of the B</etc/SCAMP/soa.conf> file, or an
alternate file specified by the B<SCAMP> environment variable.  The file is
formatted as key-value pairs, one per line, with optional blank lines and
comments introduced by C<#>.  Keys and values are separated by C<=>.
Additionally a number of methods are exported.

=head1 METHODS

=head2 val($var, $default)

Returns a config value.  If C<$default> is undef and the value is not
configured, an error will be logged.

=head2 bus_info

Returns multicast info for the announcement bus.

=cut
