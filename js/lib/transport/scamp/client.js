var conn = require('./connection.js'),
    tls  = require('tls'),
    soa  = require('../../index.js'),
    url =  require('url'),
    Message = require('../../handle/Message.js'),

    EventEmitter = require('events').EventEmitter;

exports.create = function (params) { return new Client(params); };

function Client(params) {
    EventEmitter.call(this);

    var info = url.parse(params.address);
    var proto;
    var me = this;
    var started;

    var clear = tls.connect({
        host: info.hostname,
        port: info.port,
        rejectUnauthorized: false
    }, function () {
        me.adjTimeout();

        var cert = clear.getPeerCertificate() || {};
        soa.debug('connection:',cert.fingerprint);
        soa.debug('expect:',params.fingerprint);

        if (params.fingerprint && cert.fingerprint !== params.fingerprint) {
            return proto._onerror(true, 'TLS FINGERPRINT MISMATCH: announce='+params.fingerprint+' peer='+cert.fingerprint);
        }

        started = true;
        proto.start();
    });

    proto = this._proto = conn.wrap(clear);
    proto.setBaseTimeout( soa.config().val('scamp.client_timeout', 90) * 1000 );
    clear.setTimeout( 10000 );

    this._pending = {};
    this._correlation = 1;
    this._info = info;

    proto.on('message', function (rpy) {
        var id = rpy.header.request_id;
        if (!id)
            return soa.error('Received reply with no request_id');

        me._call( id, null, rpy );
    });

    proto.on('lost', function () {
        me.emit('lost');
        Object.keys(me._pending).forEach(function (id) {
            var msg = new Message(started ?
                { error_code: 'transport', error: 'Connection lost' } :
                { error_code: 'transport', error: 'Connection could not be established', error_data: { dispatch_failure: true } });
            process.nextTick(function () { msg.end(); });
            me._call( id, null, msg );
        });
    });
};
require('util').inherits(Client, EventEmitter);

Client.prototype._call = function (id, err, rpy) {
    var rec = this._pending[id];
    if (!rec) return;
    delete this._pending[id];
    this.adjTimeout();
    clearTimeout(rec.t);
    rec.cb(err, rpy);
};

Client.prototype.request = function (params, request, callback) {

    var me = this;
    var id = request.header.request_id = this._correlation++;
    request.header.type = 'request';
    var tmout = function() {
        me._call(id, new Error("RPC Timeout (request " + id + ")"), null);
    };

    this._pending[id] = {
        cb: callback,
        t:  setTimeout( tmout, params.timeout + 5000 ),
    };
    this.adjTimeout();

    this._proto.sendMessage(request);
};

Client.prototype.adjTimeout = function () {
    var busy = false, id;
    for (id in this._pending) { busy = true; break; }
    this._proto.setBusy(busy);
};
