'use strict';
var soa          = require('../lib/index.js'),
    dgram        = require('dgram'),
    zlib         = require('zlib'),
    crypto       = require('crypto'),
    fs           = require('fs'),
    argp         = require('argparser').vals('pidfile','scoreboard').parse();

if (argp.opt('pidfile'))
    fs.writeFileSync(argp.opt('pidfile'), process.pid);

function Peering() {
    var me = this;
    me._port = 55436;
    var info = me.info = soa.config().busInfo();
    me._myHost = info.service[0];

    me.sock = dgram.createSocket('udp4');
    me.sock.bind( me._port, me._myHost );

    me.sock.on( 'message', function(blob, rinfo) {
        //console.log('got peer packet',rinfo.address,rinfo.size,crypto.createHash('md5').update(blob).digest('hex'));
        me._sawHost[rinfo.address] = Date.now();
        if (blob.length > 1) {
            if (blob.toString('binary',0,1) == 'X') {
                var hint = blob.toString('utf8',1);
                hint.split(' ').forEach(function (h) { me._hintedHost[h] = Date.now(); });
            } else {
                setTimeout(function () { me.remulticast(blob); }, 200 + Math.random() * 300); // delay a bit so multicast can win the race
            }
        }
    });

    me._sawPacket = {}; // suppress duplication if multicast is working
    me._sawHost = {};
    me._hintedHost = {};
    me._sendTime = {};

    me._pubSocks = [];

    info.discovery.forEach(function (a) {
        a = a.trim();
        var sock = dgram.createSocket('udp4');

        sock.on('listening', function () {
            me._pubSocks.push(sock);
        });

        sock.bind(info.port, a);
    });
    setInterval(me.netKeepalive.bind(me), 10000);
}

Peering.prototype.localAddresses = function () {
    if (this._localAddressesUntil >= Date.now())
        return this._localAddresses;

    this._localAddressesUntil = Date.now() + 300e3;
    this._localAddresses = {};
    var me = this;
    var iff = require('os').networkInterfaces();
    Object.keys(iff).forEach(function (ifn) {
        iff[ifn].forEach(function (a) { me._localAddresses[a.address] = true; });
    });
    //console.log('local addresses',Object.keys(this._localAddresses));
    return this._localAddresses;
};

Peering.prototype.netKeepalive = function () {
    // If we don't have any services, send an empty packet to all known hosts every 10 seconds to keep connectivity alive

    var me = this;
    var now = Date.now();
    //console.log('keepalive cycle');
    var msg = new Buffer('X' + me.knownHosts().join(' '));
    me.knownHosts(true).forEach(function (a) {
        //console.log('send keepalive to',a);
        me.sock.send(msg, 0, msg.length, me._port, a);
        me._sendTime[a] = now;
    });
};

Peering.prototype.knownHosts = function (with_seeds) {
    var me = this;
    var out = {};
    var cut = Date.now() - 300e3;
    Object.keys(me._sawHost).forEach(function (h) {
        if (me._sawHost[h] >= cut) out[h] = h;
    });
    if (with_seeds) {
        Object.keys(me._hintedHost).forEach(function (h) {
            if (me._hintedHost[h] >= cut) out[h] = h;
        });
        soa.config().val('discovery.known_hosts','10.131.209.41 10.131.209.60').split(/\s+/).forEach(function (h) {
            out[h] = h;
        });
    }
    var la = me.localAddresses();
    out = Object.keys(out).filter(function (a) { return !la[a]; });
    //console.log('known hosts',out);
    return out;
};

Peering.prototype.multicast_in = function (blob,addr) {
    var me = this;
    //console.log('saw multicast',addr,require('url').parse(addr).hostname,crypto.createHash('md5').update(blob).digest('hex'));
    me._sawPacket[blob.toString('binary')] = Date.now();

    if (addr && me.localAddresses()[require('url').parse(addr).hostname]) {
        //console.log('locally originated');
        me.knownHosts().forEach(function (a) {
            //console.log('republish to',a);
            me.sock.send(blob, 0, blob.length, me._port, a);
            me._sendTime[a] = Date.now();
        });
    }
};

Peering.prototype.remulticast = function (blob) {
    // do not republish a packet if we have seen it as multicast recently
    var s = blob.toString('binary');
    var me = this;
    if (this._sawPacket[s] && this._sawPacket[s] >= Date.now() - 1000) {
        //console.log('not remulticasting, recently seen on multicast',crypto.createHash('md5').update(blob).digest('hex'));
        return;
    }

    me._pubSocks.forEach(function (sock) {
        //console.log('remulticast',crypto.createHash('md5').update(blob).digest('hex'));
        sock.send( blob, 0, blob.length, me.info.port, me.info.group );
    });
};

function CacheFile() {
    this.contents     = new Buffer(0);
    this._path        = argp.opt('scoreboard') || soa.config().val('discovery.cache_path');
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
    var peering = new Peering();

    this.subSock = dgram.createSocket('udp4');
    this.subSock.bind( info.port, info.group, function () {
        info.discovery.forEach(function (a) { this.subSock.addMembership( info.group, a ) }, this);
    });

    this.bag = new CacheBag();

    var me = this;
    me.subSock.on( 'message', function(blob) {
        zlib.inflate(blob, function (err, ublob) {
            var addr = me.parseText( err ? blob : ublob );
            peering.multicast_in(blob, addr);
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

        return this.parseRef( blob, ref, fingerprint );
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

    me.bag.register( sendInterval * 2.1, fingerprint + workerIdent, blob );
    return serviceAddress;
};

var o = new Observer();
