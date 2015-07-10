package SCAMP::Transport::SCAMP::Server;

use Moose;
use namespace::autoclean;

use SCAMP::Transport::SCAMP::Connection;
use SCAMP::Config;
use SCAMP::Logger;

use AnyEvent::Socket;
use AnyEvent::Handle;
use Scalar::Util qw( weaken );
use Try::Tiny;

has callback => (is => 'ro', isa => 'CodeRef',       required => 1);
has tls_ctx  => (is => 'ro', isa => 'AnyEvent::TLS', required => 1); # exposed to allow injecting the announce key

has server_uri => (is => 'ro', init_arg => undef, isa => 'Str');

has _server_guard => (is => 'bare', init_arg => undef);
has _connections  => (is => 'bare', init_arg => undef);

sub BUILD {
    my $self = shift;
    weaken $self;

    my $tries = SCAMP::Config->val('scamp.bind_tries', 20);
    my $first = SCAMP::Config->val('scamp.first_port',30100);
    my $last  = SCAMP::Config->val('scamp.first_port',30399);

    while (!$self->{_server_guard} && $tries) {
        my $port = $first + int rand ($last - $first + 1);
        try {
            my $addr = SCAMP::Config->bus_info->{service}[0]; # XXX multihoming
            $self->{_server_guard} = tcp_server($addr, $port, sub { $self->_accept(@_) if $self });
            $self->{server_uri} = "scamp+tls://$addr:$port";
        } catch {
            SCAMP::Logger->info('scamp-server:',$_,'retrying...');
        };
        $tries--;
    }
    $self->{_server_guard} or SCAMP::Logger->fatal('Could not bind scamp-server socket');
    SCAMP::Logger->info('Bound to',$self->server_uri);

    $self->{_connections} = {};
}

sub _accept {
    my ($self, $sock, $host, $port) = @_;
    weaken $self;
    my $count = 0;

    SCAMP::Transport::SCAMP::Connection->accept(
        conn_tag   => "incoming($host, $port, $sock)", # $sock included to guarantee uniqueness
        conn_set   => $self->{_connections},

        socket     => $sock,
        timeout    => SCAMP::Config->val('scamp.server_timeout', 120),
        tls_ctx    => $self->tls_ctx,

        on_message => sub {
            return unless $self;
            my ($conn, $request) = @_;
            $count++; $conn->busy(!!$count);
            $self->callback->($request, sub {
                my $reply = shift;
                $reply->header->{request_id} = $request->header->{request_id};
                $conn->send_message($reply);
                $count--; $conn->busy(!!$count);
            });
        },
    );
}

__PACKAGE__->meta->make_immutable;
