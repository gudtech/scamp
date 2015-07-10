package SCAMP::Transport::SCAMP::Connection;

use Moose;
use namespace::autoclean;

use JSON;
use Encode;
use Try::Tiny;
use Scalar::Util qw( weaken );
use Errno qw( ETIMEDOUT );
use AnyEvent::Handle;

use SCAMP::Stream;

has connection => (is => 'ro', isa => 'AnyEvent::Handle', required => 1);
has conn_tag   => (is => 'ro', isa => 'Str',              required => 1);
has conn_set   => (is => 'ro', isa => 'HashRef',          required => 1, weak_ref => 1);

has on_message => (is => 'ro', isa => 'CodeRef',          required => 1);
has on_lost    => (is => 'ro', isa => 'CodeRef');

has fingerprint => (is => 'ro', isa => 'Str');
has timeout     => (is => 'ro', isa => 'Int');
has busy        => (is => 'rw', isa => 'Bool', trigger => sub { $_[0]->_adj_timeout });

has _incoming_messages => (is => 'bare', init_arg => undef);
has _outgoing_messages => (is => 'bare', init_arg => undef);

has _next_message_in   => (is => 'bare', init_arg => undef);
has _next_message_out  => (is => 'bare', init_arg => undef);

has _corked         => (is => 'bare', isa => 'Bool'); # initable
has _corked_writes  => (is => 'bare', isa => 'Str', default => '');

sub BUILD {
    my $self = shift;
    weaken $self;

    $self->conn_set->{ $self->conn_tag } = $self;

    $self->connection->on_read(sub {
        return if !$self || $self->{_corked};
        my $hnd = shift;
        my $buf = \$hnd->{rbuf};

        my ($type, $corrno, $len) = $$buf =~ /^(\w+) (\d+) (\d+)\015\012/ or do {
            return $self->_error(error => 'Overlong request line') if length($$buf) >= 80;
            return $self->_error(error => 'Malformed request line') if substr($$buf, 0, 80) =~ /\015\012/;
            return;
        };

        length($$buf) >= $len + $+[0] + 5 or return;
        return $self->_error(error => 'Missing trailer') unless substr($$buf, $len + $+[0], 5) eq "END\015\012";

        my $body = substr($$buf, $+[0], $len);
        substr($$buf, 0, $+[0] + $len + 5) = '';

        $self->_packet($type, $corrno, $body);
    });

    $self->connection->on_starttls(sub {
        my $hnd = shift;
        return unless $self && $self->fingerprint;

        my $x509 = Net::SSLeay::get_peer_certificate($hnd->{tls});
        my $dgst = Net::SSLeay::X509_get_fingerprint($x509, 'sha1');

        return $self->_error(error => "CERTIFICATE MISMATCH! Announced $self->{fingerprint} got $dgst") unless $dgst eq $self->fingerprint;

        # yay!  uncork time
        $self->connection->push_write( $self->{_corked_writes} );
        $self->{_corked_writes} = '';
        $self->{_corked} = 0;
        $self->connection->{on_read}->($self->connection);
    });

    $self->connection->on_eof(sub {
        return unless $self;
        my $hnd = shift;
        return $self->_error(error => 'EOF with incomplete packet') if $hnd->{rbuf} ne '';
        SCAMP::Logger->debug($self->conn_tag,':','Got EOF');
        $self->_error(debug => 'EOF, no current packet');
    });

    $self->connection->on_error(sub {
        return unless $self;
        my ($hnd, $fatal, $msg) = @_;
        $self->_error(error => $msg);
    });

    $self->connection->on_timeout(sub {
        return unless $self;
        $self->_error(debug => 'Idle limit exceeded');
    });

    $self->{_incoming_messages} = {};
    $self->{_outgoing_messages} = {};
    $self->{_next_message_in} = 0;
    $self->{_next_message_out} = 0;
    $self->_adj_timeout;
}

sub accept {
    my ($cls, %args) = @_;

    my $sock = delete $args{ socket };
    my $tls  = delete $args{ tls_ctx };

    $cls->new(
        %args,
        connection => AnyEvent::Handle->new(
            fh => $sock, tls => 'accept', tls_ctx => $tls, no_delay => 1
        ),
    );
}

sub connect {
    my ($cls, %args) = @_;

    my $host = delete $args{ host };
    my $port = delete $args{ port };

    $cls->new(
        %args,
        connection => AnyEvent::Handle->new(
            connect => [ $host, $port ], tls => 'connect', no_delay => 1
        ),
    );
}

sub _adj_timeout {
    my ($self) = @_;

    $self->connection->timeout( ($self->busy || %{$self->{_incoming_messages}} || %{$self->{_outgoing_messages}}) ? 0 : $self->timeout );
}

sub _packet {
    my ($self, $type, $corrno, $body) = @_;

    if ($type eq 'HEADER') {
        return $self->_error(error => 'Out of sequence message received') unless $corrno == $self->{_next_message_in};
        $self->{_next_message_in}++;

        my $json;
        try {
            $json = decode_json $body;
        };
        if (!$json || ref($json) ne 'HASH') {
            return $self->_error(error => 'Malformed JSON in received header');
        }

        my $message = $self->{_incoming_messages}{$corrno} = SCAMP::Stream->new( header => $json );
        weaken $self;
        $message->on_ack(sub { $self->_send_packet('ACK', $corrno, $_[0]) if $self });
        $self->on_message->( $self, $message );
    }
    elsif ($type eq 'DATA') {
        my $msg = $self->{_incoming_messages}{$corrno} or return $self->_error(error => 'Received DATA with no active message');

        $msg->add_data($body);
    }
    elsif ($type eq 'EOF') {
        return $self->_error(error => 'EOF packet must be empty') if $body ne '';
        my $msg = $self->{_incoming_messages}{$corrno} or return $self->_error(error => 'Received EOF with no active message');

        $msg->finish;
        delete $self->{_incoming_messages}{$corrno};
        $self->_adj_timeout;
    }
    elsif ($type eq 'TXERR') {
        my $msg = $self->{_incoming_messages}{$corrno} or return $self->_error(error => 'Received TXERR with no active message');

        $msg->finish(Encode::decode_utf8($body));
        delete $self->{_incoming_messages}{$corrno};
        $self->_adj_timeout;
    }
    elsif ($type eq 'ACK') {
        # not an error, since we might have finished sending the message already
        my $msg = $self->{_outgoing_messages}{$corrno} or return;
        $body =~ /^[1-9][0-9]*$/ or return $self->_error(error => 'Malformed ACK body');
        $msg->{acknowledged} < $body or return $self->_error(error => 'Attempt to move ACK pointer back');
        $msg->{pointer} >= $body or return $self->_error(error => 'Attempt to move ACK pointer past end of received data');

        $msg->ack( $body - $msg->{acknowledged} );
    }
    else {
        return $self->_error(error => 'Unexpected packet of type '.$type); # already validated to \w+
    }
}

sub _send_packet {
    my ($self, $type, $corrno, $body) = @_;

    my $len = length $body;
    my $pkt = "$type $corrno $len\015\012${body}END\015\012";

    if ($self->{_corked}) {
        $self->{_corked_writes} .= $pkt;
    } else {
        $self->connection->push_write( $pkt );
    }
}

sub send_message {
    my ($self, $msg) = @_;

    my $id = $self->{_next_message_out}++;
    $self->{_outgoing_messages}{$id} = $msg;
    $self->_adj_timeout;

    $self->_send_packet('HEADER', $id, encode_json($msg->header));

    weaken $self;
    weaken $msg;
    $msg->on_some_data(
        sub {
            return unless $self;
            for (my $i = 0; $i < length($_[0]); $i += 2048) {
                $self->_send_packet('DATA', $id, substr($_[0],$i,2048));
            }
        },
        sub {
            return unless $self;
            $self->_send_packet(defined($msg->error) ? 'TXERR' : 'EOF',  $id, $msg->error || '');
            delete $self->{_outgoing_messages}{$id};
            $self->_adj_timeout;
        },
    );
}

sub _error {
    my ($self, $level, $msg) = @_;

    SCAMP::Logger->$level($self->conn_tag, ':', $msg);

    for my $pending (values %{ $self->{_incoming_messages} }) {
        $pending->finish('Connection closed before message finished');
    }
    $self->{_incoming_messages} = {};
    $self->connection->destroy;
    delete $self->conn_set->{ $self->conn_tag } if $self->conn_set;
    $self->on_lost->() if $self->on_lost;
}

sub is_open { !$_[0]->connection->destroyed }

__PACKAGE__->meta->make_immutable;
