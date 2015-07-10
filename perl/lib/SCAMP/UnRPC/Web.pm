package UnRPC::Web;

use Moose;
use namespace::autoclean;
use Scalar::Util 'reftype';

sub invoke_action {
    my ($self, $request, $action, $params) = @_;

    my $rq = $request->stash->{rq};
    $request->stash( cgi_headers => $params );
    $action->call($request, $params);

    my $rsrep = $request->stash->{response};

    if ($rsrep->{psgi}) {
        my $psgi = $rsrep->{psgi};

        $params->{'psgi.version'} = [1,1];
        $params->{'psgi.url_scheme'} = $rq->request_header->{psgi_scheme};
        $params->{'psgi.input'} = UnRPC::HTTP::Input->new(rq => $rq);
        $params->{'psgi.errors'} = \*STDERR;
        $params->{'psgi.multithread'} = 0;
        $params->{'psgi.multiprocess'} = 1;
        $params->{'psgi.run_once'} = 0;
        $params->{'psgi.nonblocking'} = 0;
        $params->{'psgi.streaming'} = 0;

        my $res = $psgi->($params);

        if (reftype($res) eq 'CODE') {
            $res->(sub {
                my $res2 = shift;

                reftype($res2) eq 'ARRAY' or die "PSGI delayed response not array";
                my ($status, $headers, $body) = @$res2;

                if ($body) {
                    __psgi_reply($rq, @$res2);
                }
                else {
                    $rq->reply_header->{http_status} = $status;
                    $rq->reply_header->{http_headers} = $headers;
                    return UnRPC::HTTP::Output->new(rq => $rq);
                }
            });
        } else {
            reftype($res) eq 'ARRAY' or die "PSGI response not array or code";

            __psgi_reply($rq, @$res);
        }
    }
    else {
        __psgi_reply( $rq, $rsrep->{status} || 200, $rsrep->{headers} || [], [ $rsrep->{bytes} // '' ] );
    }

    return '';
}

sub __psgi_reply {
    my ($rq, $status, $headers, $body) = @_;

    my $has_cl = 0;
    for (my $i = 0; $i < @$headers; $i++) {
        if (lc($headers->[$i]) eq 'content-length') {
            $has_cl=1;
        }
    }

    if (!$has_cl && reftype($body) eq 'ARRAY' && $status >= 200 && $status != 204 && $status != 304) {
        my $len = 0;
        $len += length($_) for @$body;
        push @$headers, 'Content-Length' => $len;
    }

    $rq->reply_header->{http_status} = $status;
    $rq->reply_header->{http_headers} = $headers;

    if (reftype($body) eq 'ARRAY') {
        for my $str (@$body) {
            $rq->response_data($str);
        }
    }
    else {
        while (defined (my $str = $body->getline)) {
            $rq->response_data($str);
        }
    }
}

sub get_params {
    my ($self, $rq) = @_;

    # NOT eagerly fetching request data

    return $rq->request_header->{cgi_headers};
}

__PACKAGE__->meta->make_immutable;

{
    package UnRPC::HTTP::Input;
    use Moose;
    has rq => ( is => 'ro', required => 1 );

    sub read {
        my $self = shift;
        $self->rq->read_request(@_);
    }

    sub close { }

    no Moose;
    __PACKAGE__->meta->make_immutable;
}

{
    package UnRPC::HTTP::Output;
    use Moose;
    has rq => ( is => 'ro', required => 1 );

    sub write {
        my ($self, $bytes) = @_;
        $self->rq->response_data($bytes);
    }

    sub close { }

    no Moose;
    __PACKAGE__->meta->make_immutable;
}

1;
