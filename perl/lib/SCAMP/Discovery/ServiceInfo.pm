package SCAMP::Discovery::ServiceInfo;

# This roughly corresponds to lib/handle/service.js but one big difference is
# that it is _immutable_

use Moose;
use namespace::autoclean;
use Try::Tiny;

use JSON::XS;
use MIME::Base64;
use Digest;
use File::Slurp 9999.14;
use Crypt::X509;
use Crypt::OpenSSL::RSA;
use SCAMP::Config;

has data          => (is => 'ro', required => 1, isa => 'ArrayRef');
has json_blob     => (is => 'ro', required => 1, isa => 'Str');
has cert_pem      => (is => 'ro', required => 1, isa => 'Str');
has sig_base64    => (is => 'ro', required => 1, isa => 'Str');

has fingerprint   => (is => 'ro', isa => 'Str',  lazy_build => 1);
has verified      => (is => 'ro', isa => 'Bool', lazy_build => 1);
has offerings     => (is => 'ro', isa => 'HashRef[ArrayRef]', lazy_build => 1);
has expires       => (is => 'rw', isa => 'Num');

has _unauth_warned => (is => 'bare', init_arg => undef);

sub version       { $_[0]{data}[0] }
sub worker_ident  { $_[0]{data}[1] }
sub sector        { $_[0]{data}[2] }
sub weight        { $_[0]{data}[3] }
sub send_interval { $_[0]{data}[4] / 1000 }
sub address       { $_[0]{data}[5] }
sub envelopes     { $_[0]{data}[6] }
sub action_list   { $_[0]{data}[7] }
sub timestamp     { $_[0]{data}[8] }
sub can_envelope  { !!grep { $_ eq $_[1] } @{ $_[0]->envelopes } }

sub parse_announcement {
    my ($self, $blob) = @_;

    my ($json, $cert_pem, $sig) = split /\n\n/, $blob;

    my $data = decode_json($json);

    SCAMP::Logger->fatal('Wrong announcement version') if $data->[0] != 3;

    $self->new( data => $data, json_blob => $json, cert_pem => $cert_pem, sig_base64 => $sig );
}

sub _unpem {
    my ($text) = @_;

    decode_base64( join '', grep { !/^--/ } split /\n/, $text );
}

sub _pem {
    my ($tag, $data) = @_;

    return "-----BEGIN $tag-----\n" . encode_base64($data) . "-----END $tag-----\n";
}

sub _build_fingerprint {
    my ($self) = @_;

    my $hash   = uc Digest->new('SHA-1')->add(_unpem($self->cert_pem))->hexdigest;

    $hash =~ s/(..)(?!$)/$1:/g;
    $hash;
}

sub _build_verified {
    my ($self) = @_;

    my $ok = 0;
    try {
        my $x509      = Crypt::X509->new( cert => _unpem($self->cert_pem) );
        die $x509->error if $x509->error;

        my $verify_key = Crypt::OpenSSL::RSA->new_public_key( _pem 'RSA PUBLIC KEY', $x509->pubkey );

        $verify_key->use_sha256_hash;
        $verify_key->use_pkcs1_oaep_padding;

        $ok = $verify_key->verify( $self->json_blob, decode_base64($self->sig_base64) );
    } catch {
        SCAMP::Logger->error("Unable to verify signature for ".$self->worker_ident." $_");
    };

    $ok;
}

my %authorized_keys;
my $ak_mtime = -2**48;
my $path = SCAMP::Config->val('bus.authorized_services');

sub _get_authorized_keys {
    my $mt = (stat $path)[9];

    if ($mt != $ak_mtime) {
        my @lines = read_file($path, binmode => ':utf8');
        %authorized_keys = ();
        $ak_mtime = $mt;

        for my $line (@lines) {
            $line =~ s/#.*//;
            $line =~ s/\s+$//;
            $line =~ s/^\s+//;

            next unless length $line;

            my ($fingerprint, $toks) = $line =~ /^(\S*)\s*(.*)$/;
            my @toks = map { quotemeta } split /\s*,\s*/, $toks;
            for (@toks) { if (/:/) { s/:ALL$/:.*/ } else { $_ = "main:$_" } }
            my $tok_rx = join('|', @toks);

            $authorized_keys{ $fingerprint } = qr/^(?:$tok_rx)(?:\.|$)/i;
        }
    }

    return \%authorized_keys;
}

sub authorized {
    my ($self, $action) = @_;

    # every service is competent to requests about itself
    return 1 if $action =~ /^_meta\./;

    # nice try
    return 0 if $action =~ /:/ || $self->sector =~ /:/;

    if (!$self->verified) {
        SCAMP::Logger->error('Service does not have a valid signature ' . $self->fingerprint);
        return 0;
    }

    my $rx = $self->_get_authorized_keys->{ $self->fingerprint };
    if (!$rx) {
        #if (!$self->{_unauth_warned}) { SCAMP::Logger->error('Unauthorized service ' . $self->fingerprint); }
        #$self->{_unauth_warned} = {};
        return 0;
    }
    $self->{_unauth_warned} ||= {};
    return 1 if ($self->sector.":$action") =~ /$rx/;
    if (!$self->{_unauth_warned}{$action}++) {
        # SCAMP::Logger->error('Service '.$self->fingerprint.' not authorized to provide '.$action);
    }
    return 0;
}

sub _build_offerings {
    my ($self) = @_;

    my $list = $self->action_list;
    # expand this!

    my %map;

    for my $nsinfo (@$list)
    {
        my ($ns, @actions) = @$nsinfo;

        for my $act (@actions)
        {
            my $aname = $ns . '.' . $act->[0];
            my $vers  = $act->[2] || 1;
            my $info  = [ $aname, $vers, [ $act->[1] ? (split /,/, $act->[1]) : () ] ];

            $map{ "\L$aname.v$vers" } = $info;

            for my $tag (@{ $info->[2] }) {
                # some tags define aliases
                $map{ "\L$ns._$tag.v$vers" } = $info if $tag =~ /^(?:create|read|update|destroy)$/;
            }
        }
    }

    \%map;
}

sub can_do {
    my ($self, $action, $version, $envelope) = @_;

    my $blk = $self->offerings->{ "\L$action.v$version" } or return;  # check this FIRST to avoid costly crypto
    $self->authorized( $action ) or return;
    $self->can_envelope( $envelope ) or return;

    my $timeout = SCAMP::Config->val('rpc.timeout', 75);
    for (@{$blk->[2]}) { /^t(\d+)$/ and $timeout = $1 + 5 }

    return { name => $blk->[0], version => $blk->[1], flags => $blk->[2], service => $self, timeout => $timeout };
}

__PACKAGE__->meta->make_immutable;
