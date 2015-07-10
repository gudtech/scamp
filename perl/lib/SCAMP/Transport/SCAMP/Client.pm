package SCAMP::Transport::SCAMP::Client;

{
    package URI::scamp_Ptls;
    require URI::_server;
    @ISA = qw(URI::_server);
}

use Moose;
use namespace::autoclean;

use URI;
use SCAMP::Transport::SCAMP::Connection;
use SCAMP::Config;
use SCAMP::Logger;
use Scalar::Util qw( weaken );

has uri         => (is => 'ro', isa => 'Str', required => 1);
has fingerprint => (is => 'ro', isa => 'Str', required => 1);
has on_lost     => (is => 'ro', isa => 'CodeRef', required => 1);

has _connection => (is => 'bare', init_arg => undef);
has _pending    => (is => 'bare', init_arg => undef);
has _nextcorr   => (is => 'bare', init_arg => undef);

sub BUILD {
    my ($self) = @_;
    weaken $self;

    my $parsed = URI->new($self->uri);

    $self->{_pending} = {};
    $self->{_nextcorr} = 1;
    $self->{_connection} = SCAMP::Transport::SCAMP::Connection->connect(
        conn_tag   => "outgoing($self->{uri})",
        conn_set   => {},

        host       => $parsed->host,
        port       => $parsed->port,
        timeout    => SCAMP::Config->val('scamp.client_timeout', 90),

        fingerprint => $self->fingerprint,
        _corked    => 1,

        on_lost    => sub {
            my $sself = $self or return;
            my $p = $sself->{_pending};
            $sself->{_pending} = {};
            for my $rec (values %$p) {
                $rec->{cb}->( SCAMP::Stream->new( header => {}, error => 'Connection lost' ) );
            }
            $sself->on_lost->();
        },

        on_message => sub {
            return unless my $sself = $self;
            my ($conn, $reply) = @_;

            my $id = $reply->header->{request_id}
                or return SCAMP::Logger->error('Received reply with no request_id');

            my $rec = delete $self->{_pending}{$id}
                or return SCAMP::Logger->error('Received reply with no matching request');

            $rec->{cb}->( $reply );
            $sself->{_connection}->busy( !!%{ $self->{_pending} } );
        },
    );
}

sub _maketimeout { # WHEE CLOSURE CONTROL
    my ($self, $id) = @_;
    weaken $self;

    sub {
        return unless my $sself = $self;
        my $rec = delete $self->{_pending}{$id} or return;
        $rec->{cb}->( SCAMP::Stream->new( header => {}, error => "RPC Timeout (request $id)" ) );
        $sself->{_connection}->busy( !!%{ $sself->{_pending} } );
    };
}

sub request {
    my ($self, $rqparams, $request, $cb) = @_;

    my $id = $request->header->{request_id} = $self->{_nextcorr}++;
    $request->header->{type} = 'request';

    $self->{_pending}{$id} = {
        cb  => $cb,
        t   => EV::timer( $rqparams->{timeout}, 0, $self->_maketimeout($id) ),
    };
    $self->{_connection}->busy( !!%{ $self->{_pending} } );

    $self->{_connection}->send_message( $request );
}

__PACKAGE__->meta->make_immutable;
