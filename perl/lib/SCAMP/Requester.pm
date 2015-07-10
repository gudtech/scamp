package SCAMP::Requester;

use Moose;
use namespace::autoclean;

use SCAMP::Logger;
use SCAMP::Discovery::ServiceManager;
use SCAMP::Transport::ConnectionManager;
use SCAMP::Stream;
use JSON::XS;
use Try::Tiny;
use AnyEvent;
use EV;

has sector => (is => 'ro', isa => 'Str', default => 'main');
has services => (is => 'ro', isa => 'SCAMP::Discovery::ServiceManager', default => sub { SCAMP::Discovery::ServiceManager->new(sector => $_[0]->sector) }, lazy => 1);

has connections => (is => 'ro', isa => 'SCAMP::Transport::ConnectionManager', default => sub { SCAMP::Transport::ConnectionManager->new });

sub make_request {
    my ($self, $rqparams, $message, $cb) = @_;

    my $h = $message->header;
    my $actinfo = $self->services->lookup( $h->{action}, $h->{version}, $h->{envelope}, $rqparams->{ident} );

    if (!$actinfo) {
        return $cb->( SCAMP::Stream->new( header => {}, error => "Action $h->{action} not found" ) );
    }
    $h->{action} = $actinfo->{name};
    $rqparams->{timeout} ||= $actinfo->{timeout};
    SCAMP::Logger->debug('Issue request', $h->{action});

    my $conn = $self->connections->get( $actinfo->{service} );

    if (!$conn) {
        return $cb->( SCAMP::Stream->new( header => {}, error => "Cannot connect to service" ) );
    }

    $conn->request( $rqparams, $message, $cb );
}

sub simple_async_request {
    my ($self, %args) = @_;

    my $request = SCAMP::Stream->new(
        header => {
            action      => $args{action},
            version     => $args{version},
            ticket      => $args{ticket} || undef,
            envelope    => $args{envelope} || 'json',
            %{ $args{headers} || {} },
        },
        data => $args{binary_send} ? $args{data} : encode_json($args{data}),
    );

    my $reply = AE::cv;
    $self->make_request( { timeout => $args{timeout}, ident => $args{ident} }, $request, sub {
        shift->on_all_data( sub {
            my $response = shift;
            if ($response->error) {
                $args{cb}(0, [ 'transport', $response->error ]);
            } elsif ($response->header->{error_code}) {
                $args{cb}(0, [ $response->header->{error_code}, $response->header->{error} ]);
            } elsif ($args{raw_recv}) {
                $args{cb}(1, $response->data, $response->header);
            } else {
                my $obj = try { decode_json($response->data) };
                $args{cb}($obj ? (1, $obj) : (0, ['transport', 'JSON decode of payload failed']));
            }
        } );
    } );
}

sub simple_request {
    my ($self, %args) = @_;

    local $SCAMP::Logger::REDIRECT = $args{logger};
    EV::now_update(); # prevent immediate timeout of doom
    my $reply = AE::cv;

    unless (ref $self) {
        $self = $self->new( sector => $args{sector} // 'main' );
        $self->services->fill_from_cache;
    }
    $self->simple_async_request(%args, cb => $reply);
    return $reply->recv;
}

__PACKAGE__->meta->make_immutable;
