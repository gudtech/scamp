/*

=head1 NAME

transport/scamp/connection.js - protocol handling for SCAMP

=head1 DESCRIPTION

Encapsulates a tls.CleartextStream.

=cut

*/

var soa     = require('../../index.js'),
    EventEmitter = require('events').EventEmitter,
    maxflow = soa.config().val('flow.max_inflight', 65536),
    Message = require('../../handle/Message.js');

exports.wrap = function (clear) { return new Connection(clear); };

function Connection(clear) {
    EventEmitter.call(this);

    this._clear   = clear;
    this._started = false;
    this._outBuf  = [];
    this._inBuf   = new Buffer(256);
    this._inStart = 0;
    this._inEnd   = 0;
    this._closed  = false;

    this._incoming = {};
    this._outgoing = {};

    this._nextOutgoingID = 0;
    this._nextIncomingID = 0;

    clear.setNoDelay(true);

    clear.on('data',    this._ondata.bind(this));
    clear.on('end',     this._onerror.bind(this, false, 'EOF received'));
    clear.on('error',   this._onerror.bind(this, true));
    clear.on('timeout', this._onerror.bind(this, false, 'Idle limit exceeded'));

}
require('util').inherits(Connection, EventEmitter);

Connection.prototype.start = function () {
    this._started = true;

    if (this._clear.writable)
        this._clear.write( Buffer.concat( this._outBuf ) );
    this._outBuf = null;

    this._readPackets();
};

Connection.prototype._ondata = function (buf) {
    //console.log('GOT DATA:');
    //process.stdout.write(buf);

    //console.log('before:',this._inStart,'-',this._inEnd,'/',this._inBuf.length);
    if (buf.length + this._inEnd > this._inBuf.length) {

        var curSize = this._inEnd - this._inStart;
        var newSize = curSize + buf.length;

        var newBuf = new Buffer( newSize < 128 ? 256 : newSize * 2 );
        this._inBuf.copy( newBuf, 0, this._inStart, this._inEnd );

        this._inEnd   = curSize;
        this._inStart = 0;
        this._inBuf   = newBuf;
    }

    buf.copy( this._inBuf, this._inEnd );
    this._inEnd += buf.length;
    //console.log('after:',this._inStart,'-',this._inEnd,'/',this._inBuf.length);

    if (this._started)
        this._readPackets();
};

Connection.prototype._onerror = function(noisy, error) {

    if (this._closed) return;
    soa[ noisy ? 'error' : 'debug' ]( 'SCAMP protocol:', this._clear.remoteAddress, this._clear.remotePort, error );

    this._closed = true;
    this._clear.destroy();

    Object.keys(this._incoming).forEach(function (imno) {
        var msg = this._incoming[imno].message;
        msg.error = 'transport lost: ' + error;
        msg.end();
    }, this);
    this._incoming = {};
    this._outgoing = {};
    this.emit('lost');
};

Connection.prototype._readPackets = function () {

    while (true) {
        //console.log('readpacket:',this._inStart);
        var hdr = this._inBuf.toString('binary', this._inStart, this._inStart + 40 > this._inEnd ? this._inEnd : this._inStart + 40);
        var cut = hdr.indexOf('\n');
        if (cut < 0) {
            if (hdr.length >= 40)
                return this._onerror(true, 'Overlong header line');

            // no complete line, but still room
            return;
        }

        //soa.debug('Received header line',hdr.substring(0,cut+1));

        var match = /^(\w+) (\d+) (\d+)\r\n$/.exec(hdr.substring(0,cut+1));

        if (!match)
            return this._onerror(true, 'Malformed header line');

        var cmd = match[1];
        var msg = Number(match[2]);
        var siz = Number(match[3]);

        if (siz > 131072)
            return this._onerror(true, 'Unreasonably large packet');

        var payloadStart = match[0].length + this._inStart;
        var payloadEnd   = payloadStart + siz;

        if (payloadEnd + 5 > this._inEnd)
            return;

        //console.log('payload:',payloadStart,'-',payloadEnd);
        var payload = this._inBuf.slice(payloadStart, payloadEnd);

        if (this._inBuf.toString('binary', payloadEnd, payloadEnd + 5) != 'END\r\n')
            return this._onerror(true, 'Malformed trailer');

        //soa.debug('Payload', payload);

        this._inStart = payloadEnd + 5;

        //console.log('receive',cmd,'at',Date.now()%1000);

        var method = this._onpacket[cmd];
        if (!method)
            return this._onerror(true, 'Unhandled packet type ' + cmd);

        method.call(this, msg, payload);
    }
};

Connection.prototype._onpacket = {};
Connection.prototype._onpacket.HEADER = function(msgno, payload) {
    if (msgno != this._nextIncomingID++)
        return this._onerror(true, 'Out of sequence message received');

    var json;
    try { json = JSON.parse( payload.toString() ); } catch (e) {}

    if ('object' != typeof json)
        return this._onerror(true, 'Malformed JSON in received header');

    var info = this._incoming[msgno] = {
        message:  new Message( json ),
        received: 0,
        acked:    0,
    };
    this._setTimeout();

    this.emit('message', info.message);

    var me = this;
    info.message.on('drain', function() {
        if (info.received != info.acked) {
            info.acked = info.received;
            me._sendPacket('ACK', msgno, new Buffer( String(info.acked) ));
        }
    });
};

Connection.prototype._onpacket.DATA = function (msgno, payload) {
    var info = this._incoming[msgno];
    if (!info) return this._onerror(true, 'Received DATA with no active message');

    if (!payload.length) return;
    info.received += payload.length;

    if (info.message.write(payload) !== false) {
        // whoever is listening acknowledged the data immediately
        info.acked += payload.length;
        this._sendPacket('ACK', msgno, new Buffer( String(info.acked) ));
    } else {
        // not handled yet, will be handled when "drain" is sent
    }
};

Connection.prototype._onpacket.EOF = function(msgno, payload) {
    var info = this._incoming[msgno];
    if (!info) return this._onerror(true, 'Received EOF with no active message');
    if (payload.length) return this._onerror(true, 'EOF must have empty payload');

    info.message.end();
    delete this._incoming[msgno];
    this._setTimeout();
};

Connection.prototype._onpacket.TXERR = function(msgno, payload) {
    var info = this._incoming[msgno];
    if (!info) return this._onerror(true, 'Received TXERR with no active message');

    var msg = payload.toString();
    if (msg == '' || msg == '0') return this._onerror(true, 'Forbidden error message');

    info.message.error = msg;
    info.message.end();
    delete this._incoming[msgno];
    this._setTimeout();
};

Connection.prototype._onpacket.ACK = function(msgno, payload) {
    var info = this._outgoing[msgno];
    if (!info) return; // not an error, when we finish sending a message we delete this but we could still get acks for it

    payload = payload.toString();
    if (!/^[1-9][0-9]*/.test(payload)) return this._onerror(true, 'Malformed ACK payload');
    payload = Number(payload);
    if (payload <= info.acked) return this._onerror(true, 'ACK packet not an advance');
    if (payload > info.sent) return this._onerror(true, 'Peer tried to ACK data not yet sent');

    info.acked = payload;
    if (info.sent - info.acked < maxflow)
        info.message.resume();
};

Connection.prototype._sendPacket = function(cmd, msgno, buf) {
    var packet = Buffer.concat([
        new Buffer(cmd + ' ' + msgno + ' ' + buf.length + '\r\n'),
        buf,
        new Buffer('END\r\n'),
    ]);

    if (this._closed)
        return;

    //console.log('send',cmd,'at',Date.now()%1000);

    if (this._started) {
        // sometimes we don't get prompt notification of connection closes
        if (this._clear.writable) this._clear.write(packet);
    } else {
        this._outBuf.push(packet);
    }
};

Connection.prototype.sendMessage = function(msg) {
    var me = this;
    var id = this._nextOutgoingID++;
    var info = this._outgoing[id] = {
        message: msg,
        sent: 0,
        acked: 0,
    };

    this._sendPacket('HEADER', id, new Buffer(JSON.stringify(msg.header)));

    msg.on('data', function(d) {
        var i = 0;
        while (i < d.length) {
            me._sendPacket('DATA', id, d.slice(i, Math.min(i+131072, d.length)));
            i += 131072;
        }
        info.sent += d.length;
        if (info.sent - info.acked >= maxflow)
            msg.pause();
    });
    msg.on('end', function () {
        delete me._outgoing[id];
        if (msg.error) {
            me._sendPacket('TXERR', id, new Buffer(msg.error));
        } else {
            me._sendPacket('EOF', id, new Buffer(''));
        }
    });
};

Connection.prototype.setBaseTimeout = function (ms)   { this._timeout = ms;   this._setTimeout(); };
Connection.prototype.setBusy        = function (busy) { this._busy    = busy; this._setTimeout(); };

// do not drop connections for inactivity if there are pending requests or inflight messages
Connection.prototype._setTimeout = function () {
    var id, busy;
    for (id in this._incoming) { busy = true; break; }
    for (id in this._outgoing) { busy = true; break; }
    this._clear.setTimeout( (this._busy || busy) ? 0 : (this._timeout || 0) );
};
