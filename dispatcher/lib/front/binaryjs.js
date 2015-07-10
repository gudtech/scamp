'use strict';

var soa     = require('scamp'),
    Message = soa.module('handle/Message'),
    tickets = require('../emit/ticket'),
    BinaryServer = require('binaryjs').BinaryServer,
    util    = require('../util');

function PersistantClient(emit) {
    this.emit = emit;
    this.ip = this.session = null;
}

PersistantClient.prototype.handleRequest = function(info, cb) {

    this.last_id = +util.safeStr(info.id);
    var session = (this.session && this.session.string == info.session) ? this.session : (this.session = tickets.verify(info.session));

    var args = {
        how:  { ip: this.ip, port: this.port, ingress: 'binaryjs', new_session: function () {} },
        who:  { terminal: util.safeStr(info.terminal), session: session },
        what: {
            envelope: util.safeStr(info.envelope),
            action:   util.safeStr(info.action),
            version:  Number(util.safeStr(info.version)),
            params:   info.params,
        }
    };

    this.emit.auth_request(args, function (eobj, res) {
        if (eobj) {
            var msg = new Message({ error: eobj.msg, error_code: eobj.code, error_data: eobj.data });
            cb(msg);
            msg.end();
        } else {
            cb(res);
        }
    });
};

// HACK
// THIS IS INCOMPLETE - WE DO NOT HANDLE THE CASE WHERE A WRITE CAUSES AN ERROR AND CLOSE,
// NOR DO WE HANDLE POSSIBLE FAILURES WITHIN pipe()
function StreamOK(stream) { return stream._socket.readyState == stream._socket.constructor.OPEN; }

function reply_to_binaryjs(rpy, stream) {
    if (!StreamOK(stream)) return;

    if (!stream.writable) { // connection dropped
        stream.end();
        return stream.destroy();
    }
    stream.write(rpy.header);
    rpy.pipe(stream, { end: false });
    var didend = false;
    rpy.on('end', function() {
        if (!StreamOK(stream)) return;
        if (didend) return;
        didend = true;

        if (stream.writable) {
            stream.write({ txerr: rpy.error });
            stream.end();
        }
        stream.destroy();
    });
}

function BinaryJSFront(params) {
    var me = this;
    this.web_server = params.server;
    this.emit = params.emit;
    this.shutdown = params.shutdown;

    this.connection_stops = {};
    this.next_connection = 0;

    // we don't need to explicitly stop taking connections, that's handled by closing the main httpd socket
    [1,2].forEach(function (version) {
        var binaryserver = new BinaryServer({ server: me.web_server, path: '/binaryjs'+version });

        binaryserver.on('error', function (e) {
            soa.error('BinaryJS server communication error',e);
        });
        binaryserver.on('connection', function (client) {
            me.on_connect( client, version );
        });
    });

    me.shutdown.on('start', function () {
        Object.keys(me.connection_stops).forEach(function (id) { me.connection_stops[id](); });
    });
}

BinaryJSFront.prototype.on_connect = function (client, version) {
    var me = this;
    var p = new PersistantClient(me.emit);

    var active = 0;
    var killed = 0;
    client.on('error', function (e) {
        soa.error('BinaryJS client communication error',p.ip,e);
        if (!(killed++)) client.close();
    });

    p.ip = client._socket._socket.remoteAddress; // XXX is there an API for this?
    p.port = client._socket._socket.remotePort;

    if (version > 1) {
        client.send('', {'class':'ready'}).destroy();
    } else {
        client.send(me.emit.requester.serviceMgr.listActions(), {'class':'api'}).destroy();
    }

    client.on('stream', function (stream, meta) {
        if (meta && meta['class'] == 'ping' && version > 1) {
            if (stream.writable) stream.write({ pong: meta['cookie'] });
            stream.destroy();
        } else if (meta && meta['class'] == 'api' && version > 1) {
            if (stream.writable) stream.write(me.emit.requester.serviceMgr.listActions());
            stream.destroy();
        } else if (meta && meta['class'] == 'activity' && version > 1) {
            console.log('activity',p.ip,meta.active);
            stream.destroy();
        } else if (meta && meta['class'] == 'request1') {
            if (me.shutdown.started) return; // drop on floor

            var hold = me.shutdown.hold('Request for '+meta.action+' from '+p.ip);
            stream.on('close',function() {
                active--;
                hold.release();
                if (active == 0 && close_when_idle) client.close();
            });
            active++;

            p.handleRequest(meta, function (rpy) {
                reply_to_binaryjs(rpy, stream);
            });
        } else {
            if (stream.writable) stream.write('Unsupported class');
            stream.destroy();
        }
    });

    var close_when_idle;
    var bighold;
    var id = me.next_connection++;
    me.connection_stops[ id ] = function () {
        bighold = me.shutdown.hold('Closing websocket connection from '+p.ip);
        if (version > 1) client.createStream({'class':'shutdown', 'last_id':p.last_id}).destroy();
        close_when_idle = true;
        if (active == 0)
            client.close();
    };
    client.on('close', function() {
        delete me.connection_stops[ id ];
        if (bighold) bighold.release();
    });
};

module.exports = BinaryJSFront;
