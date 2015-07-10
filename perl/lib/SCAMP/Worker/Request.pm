package SCAMP::Worker::Request;

use Moose;
use JSON;
use Encode;
use namespace::autoclean;

has _send_func     => (is => 'ro', isa => 'CodeRef', required => 1);
has _recv_func     => (is => 'ro', isa => 'CodeRef', required => 1);
has request_header => (is => 'ro', isa => 'HashRef', required => 1);

has reply_header   => (is => 'ro', isa => 'HashRef', default => sub { { } }, init_arg => undef);

has _header_sent => (is => 'rw', isa => 'Bool', default => 0, init_arg => undef);
has _end_sent => (is => 'rw', isa => 'Bool', default => 0, init_arg => undef);
has _request_trailer_seen => (is => 'rw', isa => 'Bool', default => 0, init_arg => undef);

before reply_header => sub {
    confess "Cannot access reply headers after they have been sent" if shift->_header_sent;
};

has _request_accumulator => (is => 'bare', init_arg => undef, isa => 'Str', default => '');
has request_error => (is => 'ro', init_arg => undef, isa => 'Str');

# TODO: streaming requests
sub _read_full_request {
    my $self = shift;

    return if $self->_request_trailer_seen;

    while (!$self->{_request_trailer_seen}) {
        my ($tag, $data) = $self->_recv_func->();

        if ($tag eq 'data') {
            $self->{_request_accumulator} .= $data;
        } elsif ($tag eq 'dataend') {
            $self->{_request_trailer_seen} = 1;
        } elsif ($tag eq 'exception') {
            $self->{request_error} = Encode::decode_utf8($data);
            $self->{_request_trailer_seen} = 1;
        } else {
            die "Weird packet $tag";
        }
    }
}

sub request_body {
    my $self = shift;

    $self->_read_full_request;

    $self->request_error ? undef : $self->{_request_accumulator};
}

sub add_header_value{
    my ($self, %params) = @_;
    foreach my $key (keys %params){
        $self->{reply_header}{$key} = $params{$key};
    }
}
sub send_header {
    my ($self,%params) = @_;

    if (!$self->{_header_sent}) {
        $self->add_header_value(%params) if %params;
        
        $self->{_header_sent} = 1;
        $self->_send_func->('header', encode_json($self->{reply_header}));
    }
}

sub set_timeout {
    my ($self, $timeout) = @_;
    $self->_send_func->('timeout', $timeout);
}

# TODO: batching replies ?
sub response_data {
    my ($self, $data) = @_;

    $self->send_header;
    confess "cannot send data after trailer" if $self->{_end_sent};

    my $i = 0;
    while ($i < length $data) {
        $self->_send_func->('data', substr $data, $i, 1024);
        $i += 1024;
    }
}

sub end_of_response {
    my ($self, $error) = @_;

    return if $self->{_end_sent};
    $self->_read_full_request;

    if (defined $error) {
        $self->_send_func->('exception', Encode::encode_utf8($error));
    } else {
        $self->_send_func->('dataend', '');
    }
}

__PACKAGE__->meta->make_immutable;
__END__

=head1 NAME

SCAMP::Worker::Request - basic request object for use with SCAMP::Worker

=head1 SYNOPSIS

    sub my_service {
        my ($rq) = @_;
        say "got ", $rq->request_body // $rq->request_error;
        $rq->response_data("First part\n");
        $rq->response_data("Second part\n");
    }

=head1 DESCRIPTION

A C<SCAMP::Worker::Request> object is available to the code forked by
L<SCAMP::Worker> in order to receive request data and send a response.
Each such object has a lifetime of a single request.

This class is intended to be subclassed by users which require more
featureful request objects.

=head1 METHODS

=head2 request_header()

Returns a hash ref of the request's header.

=head2 response_header()

Allows access to the reply header as a read-write hash ref.  Will die if called
after data is sent.

=head2 request_body()

Returns the request data as a single byte string, or undef if a receive error
occurs.

=head2 request_error()

Returns the request error string.  Only valid after request_body returns undef.

=head2 response_data($bytes)

Appends a byte string to the current response.

=head2 end_of_response($error)

Called from SCAMP::Worker to signal successful completion of a service routine.
Do not call this yourself without a good reason.
