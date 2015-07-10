package SCAMP::Stream;
use Moose;
use Carp;
use namespace::autoclean;

has header    => (isa => 'HashRef', is => 'ro', required => 1);

has data     => (isa => 'Str',  writer => '_data', is => 'rw', default => '', init_arg => undef);
has finished => (isa => 'Bool', writer => '_finished', is => 'rw', default => 0, init_arg => undef);
has error    => (isa => 'Any',  writer => '_error', is => 'rw', init_arg => undef);

# XXX what should be the format of errors?

has _consumed => (isa => 'Bool', is => 'rw', default => 0, init_arg => undef);
has _somecb   => (isa => 'CodeRef', is => 'rw', init_arg => undef);
has _donecb   => (isa => 'CodeRef', is => 'rw', init_arg => undef);

has pointer   => (isa => 'Int', is => 'ro', default => 0, init_arg => undef);
has acknowledged => (isa => 'Int', is => 'ro', default => 0, init_arg => undef);
has _ackcb    => (isa => 'CodeRef', is => 'rw', init_arg => undef);

# for consumers
sub on_some_data {
    my ($self, $datacb, $donecb) = @_;

    croak "A consumer is already set" if $self->_consumed;
    $self->_consumed(1);

    $self->_somecb($datacb);
    $self->_donecb($donecb);

    my $data = $self->data;
    if (length $data) {
        $datacb->($data);
        $self->_data('');
    }

    if ($self->finished) {
        $donecb->($self);
    }
}

sub on_all_data {
    my ($self, $cb) = @_;

    croak "A consumer is already set" if $self->_consumed;
    $self->_consumed(1);

    $self->_donecb($cb);
    $self->ack($self->{pointer});

    if ($self->finished) {
        $cb->($self);
    }
}

sub ack {
    my ($self, $bytes) = @_;

    croak "Trying to acknowledge negative bytes" if $bytes < 0;
    croak "Trying to acknowledge bytes that have not arrived" if $bytes + $self->{acknowledged} > $self->{pointer};

    return unless $bytes;
    $self->{acknowledged} += $bytes;
    $self->{_ackcb}->($self->{acknowledged}) if $self->{_ackcb};
    return;
}

# for producers
sub add_data {
    my ($self, $bytes) = @_;

    croak "cannot add data, stream is finished" if $self->finished;

    $self->{pointer} += length($bytes);
    if (my $cb = $self->_somecb) {
        $cb->($bytes);
    } else {
        $self->_data($self->data . $bytes);
        $self->ack(length($bytes)) if $self->{_donecb};
    }
}

sub on_ack {
    my ($self, $on_ack) = @_;

    croak "on_ack already set" if $self->{_ackcb};
    $self->{_ackcb} = $on_ack;
}

sub finish {
    my ($self, $error) = @_;

    croak "stream is already finished" if $self->finished;

    $self->_finished(1);
    $self->_error($error);

    if (my $cb = $self->_donecb) {
        $cb->($self);
    }
}

sub BUILD {
    my ($self, $args) = @_;

    my $data  = $args->{data};
    my $error = $args->{error};
    if (defined $error and not defined $data) {
        $data = '';
    }
    if (defined $data) {
        $self->add_data($data);
        $self->finish($error);
    }
}

__PACKAGE__->meta->make_immutable;

=head1 NAME

SCAMP::Stream

=head1 SYNOPSIS

    # make a stream
    my $s1 = SCAMP::Stream->new(header => $header);

    # make a stream, synchronously
    my $s2 = SCAMP::Stream->new(header => $header, data => $data);
    my $s3 = SCAMP::Stream->new(header => $header, error => $error);

    # check stream headers
    if ($s4->header->{type} eq 'reply') { ... }

    # read a stream as parts
    sub ondata { my ($bytes) = @_; ... }
    sub onend  { my ($msg) = @_; ... }
    $s5->on_some_data(\&ondata, \&onend);

    # read a stream as a whole
    $s6->on_all_data(sub {
        $m6->data;
        $m6->error;
    });

=head1 DESCRIPTION

SCAMP::Stream implements the concept of a message with a JSON-encodable
header and a byte stream body.  It would be quite simple except
that it also needs to handle the fact that the byte stream may be presented in
an incremental manner.

A SCAMP::Stream producer must provide the header at the time the stream
object is constructed, via the C<header> init argument.  The data can be
provided at the same time in a lump through the C<data> argument (a byte
string) or later through the C<add_data> and C<finish> methods.

A stream object can be in one of two modes.  In incremental consumption
mode, entered through the C<on_some_data> method, data is B<not> stored but
rather passed directly to the callback.  If C<on_some_data> has not been called,
data is accumulated in the C<data> attribute and is available when the finish
callback is called.

Note that all strings processed by this class are B<byte> strings; it is the
user's responsibility to encode and decode them as appropriate.

B<WARNING>: Be very careful of circular references between data callbacks and
stream objects!

=head1 METHODS

=head2 on_some_data($datacb, $donecb)

Puts a stream object into incremental consumption mode, croaking if
C<on_some_data> or C<on_all_data> has been called previously.  C<$datacb> will
be called with a byte string whenever new data is added to the stream.
C<$donecb> will be called with a reference to the stream when the stream
is finished.

If you use this version, you must call C<ack> when you want more data.  C<ack>
should be called whenever data leaves fixed-size process buffers.

=head2 on_all_data($donecb)

Arranges for C<$donecb> to be called with the stream as an argument when the
stream is finished, but does B<not> enable incremental consumption mode.
Croaks if C<on_some_data> or C<on_all_data> was called previously.

This method also takes responsibility for acknowledging data sent immediately.
Do not call C<ack> yourself.

=head2 data()

Returns the data which has been added to the stream so far.  Will always
return an empty string in incremental consumption mode.

=head2 ack($bytes)

Advances the acknowledged data pointer by C<$bytes>, allowing a corresponding
amount of additional data to be sent.

=head2 acknowledged()

Returns the current value of the acknowledged data pointer.

=head2 pointer()

Returns the current value of the received data pointer.

=head2 on_ack($sub)

Registers a coderef to call whenever the acknowledged data pointer changes.
It will receive the new value as an argument.

=head2 finished()

Returns true if the stream has been finished, either by calling C<finish>
or by data having been provided at construct time.

=head2 error()

Returns the stored error.  Will always return undef if C<finished> is false.

=head2 add_data($bytes)

Adds data to the stream.  Cannot be used after C<finish>.  If no consumer
is attached, data will be queued until a consumer is.

=head2 finish($error)

Marks a stream as finished.  No more data may be added, and finish callbacks
will be called.  An error value may be provided, which will be returned by
C<error>.

=cut
