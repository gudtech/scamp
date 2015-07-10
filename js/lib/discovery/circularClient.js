'use strict';

var soa = require('../index.js');
var bconn = require('../transport/scamp/connection.js');
var util = require('util');
var events = require('events');

function CircularConn(peerstr) {
    var me = this;
    events.EventEmitter.call(me);

    var parsed = peerstr.split(/\s*;\s*/);
    me._secret = parsed[0];
    me._host = parsed[1];
    me._certhash = parsed[2];

    var clear = tls.connect({
        host: me._host,
        port: 51358,
    }, function () {
        var cert = clear.getPeerCertificate() || {};
        soa.debug('connection:',cert.fingerprint);
        soa.debug('expect:',params.fingerprint);

        if (cert.fingerprint !== me._certhash) {
            return proto._onerror(true, 'TLS FINGERPRINT MISMATCH: announce='+me._certhash+' peer='+cert.fingerprint);
        }

        me._started = true;
        me._proto.start();
    });

    me._proto = conn.wrap(clear);
    me._heartbeatMs = 15000;
    me.setHeartbeatTimer();

    proto.on('message', function (rpy) { me.onMessage(rpy.header); });
    proto.on('lost', function () { me.onLost(); });

    this.sendMessage({ type: 'getpeers' });
    this.sendMessage({ type: 'observe' });
}
util.inherits(CircularConn, events.EventEmitter);

CircularConn.prototype.sendMessage = function (h) {
    h.secret = this._secret;
    var msg = new Message(h);
    console.log('send',this._host,h);
    this._proto.sendMessage(msg);
    msg.slurp(new Buffer(0));
};

CircularConn.prototype.announce = function (blob, active) {
    this.sendMessage({ type: 'announce', blob: blob, active: active });
};

CircularConn.prototype.onMessage = function (h) {
    var me = this;
    if (h._lost) return;

    switch (h.type) {
        case 'heartbeat':
            me.setHeartbeatTimer();
            me.sendMessage({ type: 'heartbeat' });
            break;

        case 'peers':
            if (!Array.isArray(h.peers)) return;
            h.peers.forEach(function (p) {
                me.emit('peer', p);
            });
            break;

        case 'change':
            me.emit('change', h.blob, h.active);
            break;
    }
};

CircularConn.prototype.setHeartbeatTimer = function () {
    var me = this;
    if (me._lost) return;
    if (me._heartbeatTimer) clearTimeout(me._heartbeatTimer);
    me._heartbeatTimer = setTimeout(function () {
        me._proto._onerror(false, '15 seconds without receiving heartbeat');
    }, me._heartbeatMs);
};

CircularConn.prototype.onLost = function() {
    var me = this;
    if (me._lost) return;
    me._lost = true;
    if (me._heartbeatTimer) {
        clearTimeout(me._heartbeatTimer);
        me._heartbeatTimer = 0;
    }
    me.emit('lost');
};

function CircularClient() {
    this._advertise = {};
    this._connections = {};
}

CircularClient.prototype.advertize = function (blob, active) {
    var me = this;

    if (active) {
        if (me._advertise[blob]) return;
        me._advertise[blob] = true;
    }
    else {
        if (!me._advertise[blob]) return;
        delete me._advertise[blob];
    }

    Object.keys(me._connections).forEach(function (cs) {
        me._connections[cs].announce(blob, active);
    });
};

CircularClient.prototype.addConnection = function (string) {
    var me = this;
    if (this._connections[string]) return;

    var conn = this._connections[string] = new CircularConn(string);

    conn.on('lost', function () {
        if (me._connections[string] == conn) {
            delete me._connections[string];
            setTimeout(function () { me.addConnection(string); }, 1000); // currently no facility to cut loose servers that are simply gone.  TODO
            // HERE update state to remove offerings
        }
    });

    conn.on('change', function (blob, active) {
        // HERE update state
    });

    conn.on('peer', function (p) {
        me.addConnection(p);
    });

    Object.keys(me._advertise).forEach(function (blob) {
        conn.announce(blob, true);
    });
};

module.exports = CircularClient;
