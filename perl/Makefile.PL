use inc::Module::Install;

# Define metadata
name            'scamp';
abstract        'SCAMP SOA core';
author          'güdTECH';
version         '1';
license         'proprietary';
perl_version    '5.008';

install_script 'lssoa';
install_script 'soatest';

requires 'AnyEvent'             => 0;
requires 'AnyEvent::Handle'     => 0;
requires 'AnyEvent::Socket'     => 0;
requires 'Crypt::OpenSSL::RSA'  => '0.27';
requires 'Crypt::URandom'       => '0.28';
requires 'Crypt::X509'          => '0.51';
requires 'DateTime'             => 0;
requires 'Digest::SHA'          => 0;
requires 'EV'                   => 0;
requires 'File::Slurp'          => '9999.14';
requires 'IO::Socket::Multicast'=> 0;
requires 'JSON'                 => 0;
requires 'JSON::XS'             => 0;
requires 'MIME::Base64'         => '3.11';
requires 'Moose'                => 0;
requires 'namespace::autoclean' => 0;
requires 'Net::Interface'       => 0;
requires 'Net::SSLeay'          => '1.37';
requires 'Text::SimpleTable::AutoWidth' => 0;
requires 'Try::Tiny'            => 0;
requires 'URI'                  => 0;
requires 'SCAMP::Config' => 0; # and the rest
requires 'Module::Pluggable::Object' => '4.1';
requires 'Moose'         => 0;
requires 'namespace::autoclean' => 0;
requires 'Pod::JSchema'  => 0;
requires 'Proc::Daemon'  => 0;
requires 'Try::Tiny'     => 0;


WriteAll;
