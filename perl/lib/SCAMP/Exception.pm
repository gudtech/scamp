package SCAMP::Exception;
use Moose;
use base qw( Exporter );
use Scalar::Util 'blessed';
our @EXPORT = qw(throw error_report);

has 'message' => ( is => 'ro', required => 1 );
has 'code'    => ( is => 'ro', default => 'general' );
has '_bt'  => ( is => 'ro' );

use overload '""' => sub { shift->brief };

sub TO_JSON{ shift->message }

sub throw{
    my $pkg = shift if blessed($_[0]) || !ref($_[0]) && $_[0]->isa( __PACKAGE__ );
    
    my @bt;
    my $level = 0;
    my @call;
    push @bt, [@call] while @call = caller( $level++ );
    my %params = ( _bt => \@bt );
    
    $params{code}    = shift if @_ > 1;
    $params{message} = shift;
    my $class = shift;
    $class = (defined($class) && length($class)) ? __PACKAGE__ . '::' . $class : __PACKAGE__;
    require $class if $class ne __PACKAGE__;
    
    my $obj = $class->new( %params );
    die $obj;
}

sub brief{ shift->backtrace(1) }

sub backtrace{
    my $self = shift;
    my $max = shift;
    
    my @list = @{$self->_bt};
    my @out;

    my $ct;
    foreach my $line ( @list ){
        last if $max && ++$ct > $max;
        push @out, "$line->[1] line $line->[2]";
    }
    
    return "$self->{message} at " . join("\n <- ", @out);
}

sub error_report{
    my $pkg = shift if blessed($_[0]) || $_[0]->isa( __PACKAGE__ );
    my $err = shift;
    print STDERR "ERROR REPORT: $err\n";
}

1;
