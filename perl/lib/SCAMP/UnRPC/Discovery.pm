package UnRPC::Discovery;

use Moose;
use namespace::autoclean;
use UnRPC::Action;

use Module::Pluggable::Object 4.1;

has _actions => (isa => 'HashRef', is => 'ro', default => sub { { } }, init_arg => undef);
has modules => (isa => 'HashRef', is => 'ro', default => sub { { } }, init_arg => undef);

sub discover {
    my ($self, $prefix) = @_;
    my $failed;

    my $mp = Module::Pluggable::Object->new(
        filename    => __FILE__,
        search_path => $prefix,
        require     => 1,
        on_require_error => sub {
            warn $_[1];
            $failed++;
        },
    );

    my @pl = sort $mp->plugins;
    exit 1 if $failed;

    for my $pkg (@pl) {
        $pkg->can('_scamp_get_defaults') or next;

        my $mo = Class::MOP::Class->initialize($pkg);
        my ($ns, $ver) = $pkg->_scamp_get_defaults;

        $ver ||= 1;

        unless ($ns) {
            $ns = $pkg;
            $ns =~ s/^\Q${prefix}:://;
            $ns =~ s/::/./g;
        }

        $self->modules->{$ns} = $mo;

        SCAMP::Logger->debug("*** $ns");

        for my $name (sort $mo->get_method_list) { # deliberately only "own" methods

            my $method = $mo->get_method($name);
            my $info = $self->_scrape_attrs($method)
                or next;

            SCAMP::Logger->debug('+', $name);

            for my $ver (@{ $info->{versions} || [$ver] }) {
                $self->add_action( UnRPC::Action->new( name => "$ns.$info->{action}", invocant => $pkg, coderef => $method->body, flags => $info->{flags}, timeout => $info->{timeout}, version => $ver, method => $method ) );
            }
        }
    }
}

sub _scrape_attrs {
    my ($self, $method) = @_;

    my %catchrpt;
    my $rpc;
    my $public;
    my $versions;
    my $timeout;
    my $action;

    for my $attr ($method->can('attributes') ? @{ $method->attributes } : ()) {

        if ($attr =~ /^RPC(?:\((.*)\))?$/) {
            $catchrpt{':RPC'}++;
            $rpc = { map { lc() => 1 } split /,/, ($1 || "") };
        }

        if ($attr =~ /^PUB(?:\((.*)\))?$/) {
            $catchrpt{':PUB'}++;
            $public = 1;
            if ($1) {
                $catchrpt{'version number list'}++;
                $versions = [ split /,/, $1 ];
            }
        }

        if ($attr =~ /^VER\((.*)\)$/) {
            $catchrpt{'version number list'}++;
            $versions = [ split /,/, $1 ];
        }

        if ($attr =~ /^TIMEOUT\((.*)\)$/) {
            $catchrpt{'timeout'}++;
            $timeout = $1;
        }

        if ($attr =~ /^ACTION\((.*)\)$/) {
            $catchrpt{':ACTION'}++;
            my ($ac, @vers) = split /,/, $1;
            $action = $ac;
            if (@vers) {
                $catchrpt{'version number list'}++;
                $versions = \@vers;
            }
        }

    }

    return unless $rpc;

    my $fqname = $method->fully_qualified_name;

    for (@{ $versions || [] }) {
        SCAMP::Logger->error("Non-positive-integer version $_ declared for $fqname") unless /^\d+$/;
        $catchrpt{"Version $_"}++;
    }

    for (grep $catchrpt{$_} > 1, keys %catchrpt) {
        SCAMP::Logger->error("$_ declared twice for $fqname");
    }

    SCAMP::Logger->error("Invalid timeout $timeout declared for $fqname") if defined($timeout) && ($timeout !~ /^\d+$/ || $timeout <= 0 || $timeout > 86400);
    SCAMP::Logger->error("Nonalphanumeric action name $action for $fqname") if $action && $action =~ /\W/;

    $rpc->{public} = 1 if $public;

    return { flags => $rpc, versions => $versions, action => $action || $method->name, timeout => $timeout };
}

sub add_action {
    my ($self, $act) = @_;

    $self->{_actions}{ $act->name . "," . $act->version } = $act;
}

sub actions {
    my ($self) = @_;

    @{ $self->{_actions} }{ sort keys %{ $self->{_actions} } };
}

my %announcable = ( read => 1, update => 1, destroy => 1, create => 1, noauth => 1 );

sub announce_data {
    my ($self) = @_;
    my @out;

    map {
        my @flags = grep $announcable{$_}, sort keys %{ $_->flags };
        push @flags, "t".$_->timeout if $_->timeout;
        [ $_->name, join(",",@flags), $_->version ]
    } $self->actions;
}

sub get_action {
    my ($self, $key, $version) = @_;

    $self->{_actions}{$key.",".(0+$version)};
}

__PACKAGE__->meta->make_immutable;
