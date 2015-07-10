package UnRPC::JsonStore;

use Moose;
use namespace::autoclean;
use Pod::JSchema;
use JSON;
use JSON::XS;

has 'discovery' => (is => 'ro', isa => 'UnRPC::Discovery', required => 1);
has 'api' => (is => 'ro', lazy_build => 1 );

sub BUILD { $_[0]->api }

sub invoke_action {
    my ($self, $request, $action, $params) = @_;

    $request->stash( params => $params );
    $request->stash( mode => 'jsonstore' );
    $request->stash( xactionstr => $params->{xaction} || 'read' );

    my $withmeta = $request->stash->{xactionstr} eq 'read';

    # not implemented: :LIST fallback, "meta", authz

    my $api = $self->api->{ $action->name };

    # $self->check_access( $c, $action );

    # HACK - this should be just sending a JSON post, but that doesn't work due to an ExtJS bug.
    if ( $params->{records} && !ref($params->{records}) ) {
        $params->{records} = JSON->new->allow_nonref->decode( $params->{records} );
    }

    $action->call( $request, $params );

    my $response = $request->stash->{response} ||= {};
    ref( $response ) eq 'HASH' or die ["Sanity error - response not found"];

    my $root     = $request->stash->{root}  || 'records';
    my $data     = $response->{$root} ||= [];# || die ["Root '$root' not found"];

    $data = [$data] unless ref($data) eq 'ARRAY'; # data is always a list

    if (!exists $response->{recordcount}){ # don't override long counts needed for buffered stores
        $response->{recordcount}   = scalar @{$data};
    }

    $response->{success} = JSON::true;
    if ( $withmeta ){
        my $first = length (@$data) ? $data->[0] : {};
        my $fieldlist = $request->stash->{fields} || [ keys %{ $first } ];

        $response->{metaData} = {
            idProperty      => $request->stash->{idProperty} || ( exists( $first->{idx} ) ? 'idx' : 'id'), # evil / lazy
            root            => $root,
            totalProperty   => 'recordcount',
            successProperty => 'success',
            messageProperty => 'message',
            fields          => $self->_metafields( $api, $fieldlist ),
        };
    }

    return JSON::XS->new->ascii->convert_blessed->encode($response);
}

sub _metafields{
    my ($self,$def,$fieldref) = @_;

    if ( ! exists $def->{snip} ){
        $def->{snip} = undef; # now exists but false
        my $schema = $def->{schema}           or return $fieldref;
        my $ret    = $schema->return_schema   or return $fieldref;

        my $snip = $ret->rawlocate('properties/records/items/properties') || $ret->rawlocate('properties/records/properties');

        ref($snip) eq 'HASH' or return $fieldref;
        $def->{snip} = $snip;
    }
    my $snip = $def->{snip} or return $fieldref;

    my %gotfields;
    my @outfields;
    foreach my $name (@$fieldref){
        my $fdef = $snip->{$name};
        $gotfields{$name} = 1;
        if(ref($fdef) eq 'HASH' and $fdef->{type}){
            push @outfields, { name => $name, type => $fdef->{type} };
        }else{
            push @outfields, { name => $name };
        }
    }
    foreach my $name (keys %$snip){
        $gotfields{$name} && next;

        my $fdef = $snip->{$name};
        if(ref($fdef) eq 'HASH' and $fdef->{type}){
            push @outfields, { name => $name, type => $fdef->{type} };
        }
    }

    return \@outfields;
}

sub _build_api {
    my ($self) = shift;
    my %data;

    my %xaction_map = map {$_ => 1} qw'create read update destroy';
    my $modules = $self->discovery->modules;

    foreach my $ns ( keys %$modules ) {
        my $mo = $modules->{$ns};

        my %jschemas;

        my $filename = $mo->name;
        $filename =~ s|::|/|g;
        $filename .= ".pm";

        if ( my $file = $INC{$filename} ){
            my $pjs = Pod::JSchema->new( filename => $file );
            map { $data{$ns . '.' . $_->name}{schema} = $_->schema } @{ $pjs->methods || [] };
        }
    }

    return \%data;
}

sub get_params {
    my ($self, $rq) = @_;

    my $body = $rq->request_body;
    die $rq->request_error unless defined $body;

    return JSON::XS->new->utf8->decode($body);
}

__PACKAGE__->meta->make_immutable;
