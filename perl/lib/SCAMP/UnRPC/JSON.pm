package UnRPC::JSON;

use Moose;
use namespace::autoclean;
use JSON::XS;

sub invoke_action {
    my ($self, $request, $action, $params) = @_;

    $request->stash( params => $params );
    $action->call($request, $params);

    return JSON::XS->new->ascii->convert_blessed->encode($request->stash->{response} || {});
}

sub get_params {
    my ($self, $rq) = @_;

    my $body = $rq->request_body;
    die $rq->request_error unless defined $body;

    return JSON::XS->new->utf8->decode($body);
}

__PACKAGE__->meta->make_immutable;
