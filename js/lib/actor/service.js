'use strict';
// scamp/lib/actor/service.js

var soa        = require('../index.js'),
    fs         = require('fs'),
    crypto     = require('crypto'),
    Message    = require('../handle/Message.js'),
    DripSource = require('../util/DripSource.js'),
    ticket     = require('../util/ticket.js'),
    argp       = require('argparser').vals('pidfile').nonvals('debug').parse();

exports.create = function(params){ return new Service(params) }

function Service(params){
    var me = this;

    if (argp.opt('pidfile'))
        fs.writeFileSync(argp.opt('pidfile'), process.pid);

    me.actions = params.actions || [];
    me.ident = params.tag + '-' + crypto.randomBytes( 18 ).toString('base64');

    var key = me.key = fs.readFileSync(soa.config().val(params.tag + '.soa_key'));
    var crt = me.cert = fs.readFileSync(soa.config().val(params.tag + '.soa_cert'));

    me._classes = {};
    me._actions = {};

    me.announcer = soa.module('discovery/announce').create({
        ident: me.ident,
        key: key,
        cert: crt,
        sector: 'main',
        envelopeTypes: params.envelopes || ['json'],
    });
    me.announcer.setClasses( me._classes );

    me.server  = soa.server('scamp').create({
        callback: me.handleRequest.bind(me),
        key: key,
        cert: crt,
        listen: function (iface, uri) {
            me.announcer.addAddress(iface, uri);
        }
    });

    process.on('SIGINT', function () {
        soa.info('Got SIGINT');
        me.shutdown();
    });
    process.on('SIGTERM', function () {
        soa.info('Got SIGTERM');
        me.shutdown();
    });

    soa.logger().configure({ tag: params.tag, defname: 'service-' + params.tag, debug: argp.opt('debug') });
};

Service.prototype.registerAction = function( /*actionStr, flags, version, handler*/ ){
    var args = Array.prototype.slice.call(arguments);
    var handler = args.pop();
    if (!handler) throw "action handler required";
    var actionStr = args.shift();
    if (!actionStr) throw "action name required";
    var flags = args.shift() || '';
    var version = args.shift() || 1;

    var me    = this;

    var parts = actionStr.split(/\./);

    if(parts.length < 2) return null;

    var actionPart = parts.pop();
    var classStr   = parts.join('.');

    var cls    = me._classes[classStr] = me._classes[classStr] || {};
    cls[actionPart + '.v' + version] = [actionPart, flags, version];

    if (me.announcer) me.announcer.setClasses( me._classes );

    me._actions[actionStr.toLowerCase() + '.v' + version] = handler;
};

Service.prototype.fullHandler = function( orig_handler ) {
    return function (req, onrpy) {
        var m = new Message({});

        var in_parts = [];
        req.on('data', function (d) { in_parts.push(d); });
        req.on('end', function () {
            var ret = orig_handler( req.header, req.error ? new Error(req.error) : Buffer.concat(in_parts) );

            if (ret instanceof Error) {
                m.header.error = ret.message;
                m.header.error_code = ret.code;
                onrpy(m);
                m.end();
            } else {
                onrpy(m);
                new DripSource(1024, ret).pipe(m);
            }
        });
    };
};

Service.prototype.cookedHandler = function( orig_handler ) {
    return this.fullHandler(function (hdr, input) {
        if (input instanceof Error) return new Error('Failed to receive request: ' + input.message);
        if (hdr.envelope != 'json') return new Error('Unsupported envelope type: ' + hdr.envelope);

        var obj;
        try {
            obj = JSON.parse( input.toString('utf8') );
            obj = orig_handler( hdr, obj );
            return new Buffer(JSON.stringify( obj ), 'utf8');
        } catch (e) {
            var err = new Error(String(e.message));
            err.code = 'generic';
            return err;
        }
    });
};

// TODO: impliment handler for actions that expect streaming input

// TODO: expand to support other envelope types
Service.prototype.staticJsonHandler = function( orig_handler ) {
    return function (req, onrpy, check_access) {
        if (req.header.envelope != 'json') return new Error('Unsupported envelope type: ' + req.header.envelope);

        var return_handler = function(return_value) { 
            var m = new Message({});

            var drip_handler = function(value, drip_source) {
                onrpy(m);
                drip_source = drip_source || new DripSource(1024, value);
                drip_source.pipe(m);
            };

            if (!return_value) {
                onrpy(new Error('return_value required'));
            }
            else if (return_value.pipe instanceof Function) {
                drip_handler(null, return_value);
            }
            else {
                if (return_value instanceof Error) {
                    onrpy(return_value);
                }
                else if (return_value instanceof Object) {
                    drip_handler(new Buffer(JSON.stringify(return_value)));
                }
                else {
                    try {
                        drip_handler(new Buffer(return_value, 'utf8'));
                    }
                    catch (e) {
                        onrpy(e);
                    }
                }
            }
        };

        var data_parts = [];

        req.on('data', function (d) { data_parts.push(d) });

        req.on('end', function () {
            check_access(function(err, this_ticket) {
                if (err) return return_handler(err);

                var data = Buffer.concat(data_parts);

                try {
                    data = JSON.parse(data.toString('utf8'));
                }
                catch (e) { 
                    return return_handler(e); 
                }

                var ret = orig_handler(this_ticket, data, return_handler);

                if (typeof ret != 'undefined') return_handler(ret);
            });
        });
    };
};

Service.prototype.handleRequest = function (req, onrpy) {
    var me = this;

    var orig_onrpy = onrpy;

    onrpy = function (m) {
        // convenience
        if (m instanceof Error) {
            var msg = new Message({});
            msg.error = String(m);
            orig_onrpy(msg);
            msg.end('');
        } else {
            orig_onrpy(m);
        }
    };

    var handler = me._actions[ String(req.header.action).toLowerCase() + '.v' + req.header.version ];
    if(!handler) return onrpy(new Error("action not found"));

    // TODO: refactor - the handler itself shouldn't be the one calling this function to check access, but
    //       good enough for now - only actions that need access checking are using staticJsonHandler.
    handler(req, onrpy, function (callback) { 
        var this_ticket = ticket.verify(req.header.ticket);

        ticket.checkAccess({
            action: { 
                name: req.header.action.toLowerCase(),
                envelope: req.header.envelope,
                version: req.header.version
            },
            ticket: this_ticket
        }, function(err) {
            callback(err, this_ticket);
        });
    });
};

var shutdown = false;

// As-is, this code won't work properly when multiple worker objects exist
Service.prototype.shutdown = function (){
    var me = this;

    soa.info('Suspending announcements...');

    if(shutdown) return;
    shutdown = true;
    me.announcer.suspend();

    setTimeout(function(){
        soa.debug('Waiting for requests to finish...');
        // wait for requests to finish
        setInterval(function(){
            if(true){
                soa.info('Shutdown complete - Clean');
                process.exit();
            }
        },50);

        setTimeout(function(){
            soa.error('Force Shutdown - Timeout');
            process.exit();
        }, 5000);

    }, 500 );
};
