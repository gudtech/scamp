package UnRPC::Request;

use Carp;
use SCAMP::Exception;
use Moose;
use namespace::autoclean;

# this class emulates a 'Catalyst' master object

has '_stash' => (is => 'bare', default => sub { {} });

sub out{
    my $self = shift;
    my %params = @_;
    my $r = $self->stash->{response} ||= {};
    map { $r->{$_} = $params{$_} } keys %params;
}

sub client_id   { shift->stash->{client_id} }
sub account_id  { shift->stash->{client_id} } # preparation for client -> account migration

sub user_id     { shift->stash->{user_id} }
sub terminal_id { shift->stash->{terminal_id} }
sub terminal_token { shift->stash->{terminal} }

sub ticket      { shift->stash->{ticket} }
sub session     { shift->stash->{session} } #deprecated - same as ticket

sub merge_user_restrictions{
    my $self = shift;
    my $mhash = shift;
    
    my $cond = $self->user_restrictions(@_);
    
    foreach my $key ( keys %$cond ){
        my $cv = $cond->{$key};
        $cv = [$cv] unless ref($cv) eq 'ARRAY';
        
        if (exists $mhash->{$key}){ #argument specified for key
            my $mv = $mhash->{$key};
            my $array = ref($mv) eq 'ARRAY';
            
            #filter values provided against the values which are allowed under the list of acceptable values
            my %ok_values = map { $_ => 1 } @$cv;
            $mv = [  grep { $ok_values{$_} } grep { defined($_) && length($_) } $array ? @$mv : ($mv)  ];
            
            @$mv == 0 and throw "auth_restrict","Access restricted (incorrect $key)";
            #preserve arrayness if possible
            $mhash->{$key} = (!$array && (@$mv == 1)) ? $mv->[0] : $mv;
            
        }else{ # no argument specified means provide all allowable values
            $mhash->{$key} = (@$cv == 1) ? $cv->[0] : $cv;            
        }
    }
}

sub user_restrictions {
    my $self = shift;
    my $inref = ref( $_[0] ) eq 'HASH' ? $_[0] : { @_ };
    
    my $ticket = $self->{_stash}{ticket} or croak "cannot call ->user_conditions without stashed ticket";

    my $restrictions = $ticket->restrictions;
    
    # return empty hashref to indicate "unrestricted" access
    return {} if !@$restrictions;
    
    # if any restrictions are present, they must be referenced in the input reference, else we're going to bail out
    my %out;
    my %rmap = map { $_->{handle} => $_->{record_ids} } @$restrictions;
    foreach my $handle ( keys %$inref ){
        my $fieldname = $inref->{$handle};
        
        my $ids = $rmap{ $handle } or throw "authz","Access denied ($handle)";
        
        $out{$fieldname} = $ids;
    }
    
    return \%out;
}

sub stash {
    my $c    = shift;
    my $stash = $c->{_stash};

    if (@_) {
        my $new_stash = @_ > 1 ? {@_} : $_[0];
        croak('stash takes a hash or hashref') unless ref $new_stash;
        foreach my $key ( keys %$new_stash ) {
            $stash->{$key} = $new_stash->{$key};
        }
    }

    return $stash;
}

__PACKAGE__->meta->make_immutable;
