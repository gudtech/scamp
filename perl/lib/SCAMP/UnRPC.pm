package UnRPC;

use Moose;
use Scalar::Util 'blessed';
use Try::Tiny;
use namespace::autoclean;

use UnRPC::JSON;
use UnRPC::Web;
use UnRPC::JsonStore;
use UnRPC::Request;

use SCAMP::Logger tag => 'unrpc';

has discovery => (is => 'ro', isa => 'UnRPC::Discovery', required => 1, handles => [qw[ announce_data ]]);
has _handlers => (is => 'ro', isa => 'HashRef');
has preinvoke => (is => 'ro', isa => 'CodeRef');
has endinvoke => (is => 'ro', isa => 'CodeRef');

sub BUILD {
    my $self = shift;

    $self->{_handlers} = {
        json      => UnRPC::JSON->new,
        web       => UnRPC::Web->new,
        jsonstore => UnRPC::JsonStore->new(discovery => $self->discovery),
    };
}

# some frontend processing has already been done by the dispatcher

sub service {
    my ($self, $rq) = @_;

    my $rbytes;
    my $request = UnRPC::Request->new;
    $request->stash( rq => $rq );

    my $rhead = $rq->request_header;
    my $hname = $rhead->{envelope};
    my $handler = $self->{_handlers}{$hname} || $self->{_handlers}{json};

    try {
        my $params = $handler->get_params($rq);

        my $action = $self->discovery->get_action( $rhead->{action} || '', $rhead->{version} || 1 );
        loginfo "Action requested", { name => $rhead->{action} };
        die "Action not supported" unless $action;

        $rq->set_timeout( $action->timeout ) if $action->timeout;
        $self->preinvoke->($rq, $request, $action->name, $params, $action) if $self->preinvoke;
        $rbytes = $handler->invoke_action( $request, $action, $params );

    } catch {
        my $error = $_;
        my $message;
        my $code    = 'general';

        if ( blessed $error ){
            $code    = $error->code    if $error->can('code');
            $message = $error->message if $error->can('message');
            $message ||= "$error";

        }elsif(ref($error) eq 'SCALAR'){
            $message = $error = $$error;
        }elsif(ref($error) eq 'ARRAY'){
            ($message)       = @$error if @$error == 1;
            ($code,$message) = @$error if @$error >= 2;
        }else{
            $message = $error;
        }

        loginfo "Exception thrown", { code => $code, message => "$message" };

        $rq->reply_header->{error_code} = $code;
        $rq->reply_header->{error} = $message;
        $rbytes = '';
    };

    $rq->response_data($rbytes);
    $self->endinvoke->() if $self->endinvoke;
}

__PACKAGE__->meta->make_immutable;
