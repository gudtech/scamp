package UnRPC::Documentation;

# A doc-plugin holds a weak reference to the ::Discovery object, but after
# installation the ::Discovery object holds a strong reference to us

use Moose;
use namespace::autoclean;
use UnRPC::Discovery;
use UnRPC::Action;

has owner => (isa => 'UnRPC::Discovery', is => 'ro', required => 1, weak_ref => 1);

has documentation => (isa => 'ArrayRef', is => 'ro', lazy_build => 1);

sub BUILD {
    my $self = shift;

    $self->owner->add_action( UnRPC::Action->new( name => '_meta.documentation', invocant => $self, coderef => $self->can('documentation_rpc'), flags => { noauth => 1 }, version => 1 ) );

    $self->documentation; # don't wait until the fork
}

sub _build_documentation {
    my ($self) = @_;

    require Pod::JSchema;
    my %modinfo;
    my @out;

    for my $act ($self->owner->actions) {
        next unless $act->method && $act->flags->{public};

        my $filename = $act->method->original_package_name . ".pm";
        $filename =~ s|::|/|g;
        $filename = $INC{ $filename } or next;

        my $pjs = $modinfo{$filename} ||= Pod::JSchema->new( filename => $filename );

        my $name = $act->method->original_name;
        my ($pjs_method) = grep( $_->name eq $name, @{ $pjs->methods } ) or next;
        $pjs_method->tags->{jschema} or next;

        push @out, { name => $act->name, version => $act->version, flags => $act->flags, html => $pjs_method->html };
    }

    \@out;
}

sub documentation_rpc {
    my ($self, $c, $p) = @_;

    $c->out( actions => $self->documentation );
}

__PACKAGE__->meta->make_immutable;
