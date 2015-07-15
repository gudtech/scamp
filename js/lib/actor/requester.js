
// scamp/lib/actor/requester.js

var soa           = require('../index.js'),
    connectionMgr = soa.module('util/connectionMgr'),
    Message       = soa.module('handle/Message');
    
exports.create = function(params){ return new Requester(params) }

function Requester(params){
    var me = this;
    
    if(!params.ident) throw "ident is required";
    
    me.ident = params.ident;
    me.sector = params.sector;
    
    me.serviceMgr = soa.module('util/serviceMgr').create({ sector: params.sector || 'main' });
    me.observer   = soa.module('discovery/observe').create({ serviceMgr: me.serviceMgr });
    
};

Requester.prototype.makeRequest = function ( params, body, callback){
    var request   = new Message(params.header || {
        sector:   this.sector,
        action:   params.action,
        envelope: params.envelope,
        version:  params.version,
        ticket:   params.ticket,
        terminal: params.terminal,
    });

    var me = this;
    this.forwardRequest({}, request, function (err, rpy, service) {
        if (rpy && service && rpy.header.error_data && rpy.header.error_data.dispatch_failure &&
                !params.retried && !params.ident) {

            // TODO: we might consider being smarter about this.
            soa.error('Failed to dispatch',params.action,'to',service.address,'redispatching...');
            service.registration.connectFailed();
            params.retried = true;
            return me.makeRequest(params, body, callback);
        }
        return callback(err, rpy, service);
    });
    request.slurp( body );
};

Requester.prototype.forwardRequest = function (params, request, onrpy) { // does apply aliases
    var me = this;
    var info = this.serviceMgr.findAction( request.header.action, request.header.envelope, request.header.version, params.ident );
    if( !info ) return onrpy( new Error('Action ' + request.header.action + ' not found'), null );

    request.header.action  = info.action;
    request.header.version = info.version;

    var client = connectionMgr.getClient( info.address, info.fingerprint );
    if( !client ) return onrpy( new Error('bad service address:' + info.address ), null );

    client.request({ timeout: params.timeout || info.timeout }, request, function (err, rpy) { return onrpy(err, rpy, info.service); } );
};

Requester.prototype.makeJsonRequest = function (header, payload, callback) {

    header.envelope || (header.envelope = 'json');
    header.version || (header.version = 1);

    this.makeRequest( header, new Buffer( JSON.stringify(payload)) , function response( err, soa_res ) {
        if(err){
            soa.error('internal request failed',err);
            return callback('transport', err.toString(), null);
        } else {
            var acc = [];
            soa_res.on('data', function (d) { acc.push(d); });
            soa_res.on('end', function () {
                if (soa_res.error)
                    return callback('transport', soa_res.error, null);
                if (soa_res.header.error_code)
                    return callback(soa_res.header.error_code, soa_res.header.error, null);

                var resp = Buffer.concat(acc).toString();
                try {
                    resp = JSON.parse(resp);
                } catch (e) {}

                if ('object' != typeof resp)
                    return callback('transport', 'failed to parse JSON response', null);

                return callback(null, null, resp);
            });
        }
    });
};
