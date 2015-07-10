'use strict';

// As a transition plan for the deployment of pinboards, we will set the multicast interface to 'lo' on all servers.
// Services which have not been upgraded will send multicast packets.
// This bridge will detect multicast packets which are announcing services hosted on a local IP address and express them to the pinboard
// It will also observe the pinboard and send packets for non-local services
// A service may have {pbnative:1} in the extension field to indicate that it is announcing directly/only on a pinboard and we should copy it to multicast even if local

var soa          = require('../lib/index.js'),
    dgram        = require('dgram'),
    zlib         = require('zlib'),
    crypto       = require('crypto'),
    fs           = require('fs'),
    argp         = require('argparser').vals('pidfile').parse();

if (argp.opt('pidfile'))
    fs.writeFileSync(argp.opt('pidfile'), process.pid);

var client = new (soa.module('discovery/circularClient.js'))();

function CacheFile() {
    this.contents     = new Buffer(0);
    this._path        = soa.config().val('discovery.cache_path');
    this._maxAge      = soa.config().val('discovery.cache_max_age', 120);
}

CacheFile.prototype.update = function (contents) {
    if (String(contents) == String(this._contents)) return;
    this._contents = contents;

    fs.writeFileSync(this._path + '.new', contents);
    fs.renameSync(this._path + '.new', this._path);

    this._touch(false); // reset timer
};

CacheFile.prototype._touch = function (real) {
    if (real) fs.utimesSync(this._path, new Date(), new Date());

    clearTimeout(this._timeout);
    var me = this;
    this._timeout = setTimeout(function () { me._touch(true); }, this._maxAge * 500);
};



function CacheBag() {
    this._file = new CacheFile();
    this._bag = {};
    this._timeouts = {};
}

CacheBag.prototype.register = function (ttl, key, blob) {
    key = '$' + key;
    var me = this;

    if (/\n%%%\n/.test(blob)) throw "Illicit separator contained in blob"; // if the blob is totally well-formed this is impossible anyway

    clearTimeout(this._timeouts[key]);
    this._timeouts[key] = setTimeout(function () { delete me._bag[key]; me._issue(); }, ttl);

    me._bag[key] = blob;
    me._issue();
};

CacheBag.prototype._issue = function() {
    var cat = [];

    Object.keys(this._bag).sort().forEach(function (k) {
        cat.push(new Buffer('\n%%%\n'));
        cat.push(this._bag[k]);
    }, this);

    this._file.update(Buffer.concat(cat));
};



var seen_timestamps = {};

function Observer() {
    var info = soa.config().busInfo();

    this.subSock = dgram.createSocket('udp4');
    this.subSock.bind( info.port, info.group );
    info.discovery.forEach(function (a) { this.subSock.addMembership( info.group, a ) }, this);

    this.bag = new CacheBag();

    var me = this;
    me.subSock.on( 'message', function(blob) {
        zlib.inflate(blob, function (err, ublob) {
            me.parseText( err ? blob : ublob );
        });
    });
}

Observer.prototype.parseText = function (blob) {
    //console.log('received data ' + data.toString());

    //var start = (new Date).getTime();
    try{
        var chunks = blob.toString('binary').split('\n\n');
        var data = chunks[0];
        var cert = chunks[1] + '\n';
        var sig  = new Buffer(chunks[2], 'base64');

        var ref = JSON.parse( data );

        var cert_der = new Buffer(cert.toString().replace(/---[^\n]+---\n/g,''), 'base64');
        var sha1 = crypto.createHash('sha1').update(cert_der).digest('hex');
        var fingerprint = sha1.replace(/..(?!$)/g, '$&:').toUpperCase();

        if (!crypto.createVerify('sha256').update(data).verify(cert.toString(), sig))
            throw 'Invalid signature';

        this.parseRef( blob, ref, fingerprint );
    } catch(e){
        console.log('Parse error', e, blob.toString());
    }
    //console.log('parseRef took', (new Date).getTime() - start , 'ms');
};

Observer.prototype.parseRef = function( blob, ref, fingerprint ){

    if(! ref instanceof Array ) throw "Invalid ref - must be an array";
    var me      = this,
        version = ref.shift();

    if ( version    !== 3 )  throw "unknown protocol version: " + version;
    if ( ref.length !=  8 )  throw "invalid number of elements";

    var workerIdent    = ref.shift(),
        sector         = ref.shift(),
        weight         = ref.shift(),
        sendInterval   = ref.shift(),
        serviceAddress = ref.shift(),
        protocols      = ref.shift(),
        actionList     = ref.shift(),
        timestamp      = ref.shift();

    var key = fingerprint + '-' + workerIdent;

    timestamp = Number(timestamp);
    if (isNaN(timestamp)) throw "Timestamp must be a number";
    if (timestamp < seen_timestamps[key]) throw "timestamp "+timestamp+" is not the most recent for "+key;
    seen_timestamps[key] = timestamp;

    if(! (actionList instanceof Array)) throw "Invalid serviceList";

    me.bag.register( sendInterval * 17280, fingerprint + workerIdent, blob );
};

var o = new Observer();
