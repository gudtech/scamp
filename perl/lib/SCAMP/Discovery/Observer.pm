package SCAMP::Discovery::Observer;

use Moose;
use namespace::autoclean;
use Scalar::Util qw( weaken );

use IO::Socket::Multicast;
use Compress::Zlib qw( uncompress );
use EV;
use AnyEvent::Util;
use Errno 'EAGAIN';

use SCAMP::Config;
use SCAMP::Logger;

# we don't use FileHandle but it's needed due to a shocking Perl 5.10.1 core bug::
# Crypt::URandom references FileHandle, causing the FileHandle:: package to be
# vivified but empty, breaking IO::File usage
# FIXED in 5.11.3
use FileHandle;

has _socket   => (is => 'bare', init_arg => undef);
has _listener => (is => 'bare', init_arg => undef);
has manager   => (is => 'ro', required => 1, weak_ref => 1, isa => 'SCAMP::Discovery::ServiceManager');

sub BUILD {
    my ($self) = @_;

    my $info = SCAMP::Config->bus_info;

    my $sock = IO::Socket::Multicast->new(
        LocalHost => $info->{group},
        LocalPort => $info->{port},
        ReuseAddr => 1,
    ) or SCAMP::Logger->fatal("Cannot create discovery socket: $!");

    for my $if ( @{$info->{discovery}} ) {
        $sock->mcast_add( $info->{group}, $if ) or SCAMP::Logger->fatal("Cannot bind discovery socket: $!");
    }

    fh_nonblocking($sock, 1);

    $self->{_socket} = $sock;
    $self->{_listener} = EV::io($sock, EV::READ, sub {
        return unless $self && $self->manager;
        my ($cbuffer, $ubuffer);
        if (! $self->{_socket}->recv($cbuffer, 65536) ) {
            SCAMP::Logger->error("Receive on discovery socket failed: $!") if $! != EAGAIN;
        } else {
            if (!defined( $ubuffer = uncompress($cbuffer))) {
                SCAMP::Logger->error("Invalid compressed data in packet from ",$self->{_socket}->peerhost);
                $ubuffer = $cbuffer; # try it as uncompressed
            }
            $self->manager->inject( 1, "[from ".$self->{_socket}->peerhost."]", $ubuffer );
        }
    });
    weaken $self; # for the callback
}

__PACKAGE__->meta->make_immutable;
