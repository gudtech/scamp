'use strict';
/*

=head1 NAME

discovery/observe.js - observation handler for SOA

=head1 DESCRIPTION

This module implements a ZeroMQ-based listener for service announcements in
the scamp system.  It provides an observer class, which is not directly
exported.

=head1 EXPORTED FUNCTIONS

=head2 create(params)

Creates an observer object, returns it, and begins observing service
announcements.  C<params.serviceMgr> must be a reference to an object
from C<util/serviceMgr>, which will be filled with information from
the observed announcements.

=cut

*/

var soa          = require('../index.js'),
    dgram        = require('dgram'),
    zlib         = require('zlib'),
    inherits     = require('util').inherits,
    crypto       = require('crypto'),
    service      = soa.module('handle/service'),
    EventEmitter = require('events').EventEmitter;


exports.create = function(params) { return new Observer(params) };

function Observer ( params ){
    var me = this;

    EventEmitter.call(this);

    var info = soa.config().busInfo();

    me.subSock = dgram.createSocket('udp4');
    me.subSock.bind( info.port, info.group, function() {
        info.discovery.forEach(function(a) { me.subSock.addMembership( info.group, a ); });
    });

    if(!params.serviceMgr) throw "serviceMgr is required";
    me.serviceMgr = params.serviceMgr;

    me.subSock.on( 'message', function(blob) {
        zlib.inflate(blob, function (err, ucblob) {
            if (err) {
                // soa.error('Failed to decompress announcement', err);
                ucblob = blob;
            }
            me.serviceMgr.registerService( ucblob.toString('binary'), false );
        });
    });
}
inherits(Observer, EventEmitter);

