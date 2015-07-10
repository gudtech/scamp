package SCAMP::Discovery::Announcer;

use Moose;
use namespace::autoclean;
use Scalar::Util qw( weaken );
use IO::Socket::Multicast;
use Compress::Zlib 'compress';

use EV;
use JSON;
use Crypt::URandom qw( urandom );
use Crypt::OpenSSL::RSA;
use MIME::Base64;

use Time::HiRes qw( time );

# we don't use FileHandle but it's needed due to a shocking Perl 5.10.1 core bug::
# Crypt::URandom references FileHandle, causing the FileHandle:: package to be
# vivified but empty, breaking IO::File usage
# FIXED in 5.11.3
use FileHandle;

# a "version 4" announce packet
# * announces itself as version 3 for compatibility
# * includes a hash at the end of what used to be the envelopes field
# * this hash includes keys with well-known names, which are typically RLE-coded vectors
# * eventually (version 5?) we will move all data into the extension area, and have a simple hash-organized format
# * for now (compatibility!), data can exist in either place
# * 4 vectors: flags, versions, namespace, name
# * a new vector: sector

has name        => (isa => 'Str', is => 'ro', required => 1);
has sector      => (isa => 'Str', is => 'ro', default => 'main');
has sign_pem    => (isa => 'Str', is => 'ro', required => 1);
has cert_pem    => (isa => 'Str', is => 'ro', required => 1);

has active      => (isa => 'Bool', is => 'rw', default => 1, trigger => sub { shift->_new_packet });
has ident       => (isa => 'Str', is => 'ro', builder => '_build_ident', lazy_build=>1);
has weight      => (isa => 'Num', is => 'rw', default => 1, trigger => sub { shift->_new_packet });
has interval    => (isa => 'Num', is => 'ro', default => 5);
has address     => (isa => 'Str', is => 'rw', trigger => sub { shift()->_new_packet }, required => 1);
has envelopes   => (isa => 'ArrayRef[Str]', is => 'rw', trigger => sub { shift()->_new_packet }, required => 1);
has actions     => (isa => 'ArrayRef[UnRPC::Action]', is => 'rw', trigger => sub { shift()->_new_packet }, required => 1);

has _sockets    => (is => 'bare', init_arg => undef);
has _interval   => (is => 'bare', init_arg => undef);

has _packet     => (is => 'ro', isa => 'Str', clearer => '_new_packet', builder => '_build_packet', lazy => 1);
has _signing_key=> (is => 'ro', isa => 'Crypt::OpenSSL::RSA', init_arg => undef, lazy_build => 1);

sub _build__signing_key { Crypt::OpenSSL::RSA->new_private_key( $_[0]->sign_pem ) }

sub _build_ident { $_[0]->name . ':' . encode_base64(urandom(18), '') }

sub BUILD {
    my ($self) = @_;

    my $info = SCAMP::Config->bus_info;
    $self->{_sockets} = [];

    for my $to (@{ $info->{discovery} }) {
        my $sock = IO::Socket::Multicast->new(
            LocalHost => $to,
            LocalPort => $info->{port},
            ReuseAddr => 1,
        ) or SCAMP::Logger->fatal("Cannot create announce socket: $!");

        $sock->mcast_if( $to ) or SCAMP::Logger->fatal("Cannot bind announce socket: $!");
        $sock->mcast_dest( $info->{group} . ':' . $info->{port} );

        push @{ $self->{_sockets} }, $sock;
    }

    weaken $self;
    $self->_start(0);
}

sub _start {
    my ($self, $shutting_down, $donecb) = @_;

    weaken $self;
    my $interval = $shutting_down ? 1 : $self->interval;
    my $ct = 0;

    $self->{_interval} = EV::timer 0, $interval, sub {
        return unless $self;
        #SCAMP::Logger->debug("Sending", $self->_packet);
        my $pkt = $self->_packet;
        for my $s (@{ $self->{_sockets} }) {
            $s->mcast_send( $pkt ) or SCAMP::Logger->error("Announce failed: $!");
        }

        $donecb->() if (++$ct == 4) && $shutting_down;
    };
}

sub shutdown {
    my ($self, $donecb) = @_;
    $self->active(0);
    $self->_start(1, $donecb);
}

my %announcable = ( read => 1, update => 1, destroy => 1, create => 1, noauth => 1 );

sub __torle {
    my ($list,$n) = @_;

    my @copy = @$list;
    my @out;

    while (@copy) {
        my $head = shift @copy;
        my $count = 1;
        while (@copy && $copy[0] eq $head) { $count++; shift @copy; }
        $head = 0+$head if $n;
        push @out, (ref($head) eq 'ARRAY' || $count > 1) ? [ $count, $head ] : $head;
    }

    return \@out;
}

sub _build_packet {
    my ($self) = @_;

    my $usev3 = !$ENV{SCAMP_ANNOUNCE_V4ONLY};

    my @v3classes;
    my %v3clshash;

    my %v4 = ( acns => [], acname => [], acver => [], acflag => [], acsec => [], acenv => [] );

    # assume it's already sorted
    foreach my $ac (@{ $self->actions }) {
        $ac->name =~ /^(.*)\.([^.]*)$/ or (SCAMP::Logger->error("Invalid action name $ac->[0]"), next);
        my $namespace = $1;
        my $iname = $2;
        my @flags = grep $announcable{$_}, sort keys %{ $ac->flags };
        push @flags, "t".$ac->timeout if $ac->timeout;
        my $flags = join ',', @flags;

        if ($usev3 && !$ac->sector && !$ac->envelopes) {
            # put in compat zone

            my $cls = $v3clshash{ $namespace };
            push @v3classes, $v3clshash{ $namespace } = $cls = [ $namespace ] unless $cls;

            push @$cls, [ $iname, $flags, $ac->version == 1 ? () : $ac->version ];
        }
        else {
            push @{$v4{acns}}, $namespace;
            push @{$v4{acname}}, $iname;
            push @{$v4{acver}}, 0+$ac->version;
            push @{$v4{acflag}}, $flags;
            push @{$v4{acsec}}, $ac->sector || $self->sector;
            push @{$v4{acenv}}, join ',', @{ $ac->envelopes || $self->envelopes };
        }
    }

    my $pkthash = {
        vmaj => 4, vmin => 0,
        ident => $self->ident,
        wgt => $self->active ? $self->weight : 0,
        intvl => $self->interval * 1000, # sec -> msec
        uri => $self->address,
        env => $self->envelopes,
        sector => $self->sector,
        @v3classes ? (v3actions => \@v3classes) : (),
        ts => time, # this changes whenever the packet is recalculated, allowing recipients to ignore all but the most recent version
        acname => __torle($v4{acname}),
        acns => __torle($v4{acns}),
        acflag => __torle($v4{acflag}),
        acsec => __torle($v4{acsec}),
        acenv => __torle($v4{acenv}),
        acver => __torle($v4{acver},1),
    };

    my $blob;

    if ($usev3) {
        $blob = encode_json [
            3,
            delete $pkthash->{ident},
            delete $pkthash->{sector},
            delete $pkthash->{wgt},
            delete $pkthash->{intvl},
            delete $pkthash->{uri},
            [ @{ delete $pkthash->{env} }, $pkthash ],
            delete $pkthash->{v3actions},
            delete $pkthash->{ts},
        ];
    }
    else {
        $blob = encode_json($pkthash);
    }

    $self->_signing_key->use_sha256_hash;
    $self->_signing_key->use_pkcs1_oaep_padding;

    my $uc_packet = $blob . "\n\n" .
        $self->cert_pem . "\n" .
        encode_base64($self->_signing_key->sign( $blob )) . "\n";

    return compress($uc_packet, 9);
}

__PACKAGE__->meta->make_immutable;
