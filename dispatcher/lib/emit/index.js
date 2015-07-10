var tickets      = require('./ticket.js'),
    accesslog    = require('../accesslog').rpclog,
    util         = require('../util'),
    soa          = require('scamp');

function Emitter(params) {
    this.requester = soa.requester({ ident: 'gt.dispatcher' });

    this.apiKeyCache  = require('lru-cache')(100);
    this.authzTickets = require('lru-cache')(100);
    this.ipRate       = require('./ratelimit.js').create({ maxCount: 100, interval: 1000 });

    this.authzTables  = null;
    this.authzTime    = -Infinity;
}
module.exports = Emitter;

//    what.envelope, what.action, what.version, what.params - the usual SOA stuff
//    who.ticket, who.terminal, who.session, who.api_key - auth info
//    how.ip, how.user_agent, how.ingress - log details
//    how.new_session - save session info

// full autologin/authz sequence
// do authn, then pass off to authz_request with a ticket
Emitter.prototype.auth_request = function (args, cb) {

    var how = args.how, what = args.what;
    what.payload = new Buffer( JSON.stringify(what.params));
    var start = new Date();
    var logparams = {
        date:           start,
        user_id:        undefined, // MUTABLE
        requester_ip:   how.ip,
        requester_port: how.port,
        user_agent:     how.user_agent,
        ingress:        how.ingress,
        action:         what.action,
        version:        what.version,
        request_bytes:  what.payload.length,
        response_bytes: 0, // MUTABLE
        error_code:     undefined,
        error_message:  undefined,
    };

    return this.auth_request_unlogged( args, logparams, function (err, soa_res) {
        // at this point soa_res is guaranteed to not be a prompt failure

        var logend = function (eobj) {
            if (eobj) {
                logparams.status = 'error';
                logparams.error_code = eobj.code;
                logparams.error_message = eobj.msg;
            } else {
                logparams.status = 'success';
            }
            logparams.request_duration_seconds = (new Date() - logparams.date) / 1000;
            accesslog.log(logparams);
        };

        if (err) {
            logend(err);
        } else {
            logparams.response_bytes += Buffer.byteLength(JSON.stringify(soa_res.header));

            soa_res.on('data', function (buf) { logparams.response_bytes += buf.length; });
            soa_res.on('end', function () {
                logend(soa_res.error ? { code: 'transport', msg: soa_res.error } : null);
            });
        }

        return cb(err, soa_res);
    });
};

Emitter.prototype.auth_request_unlogged = function( args, logparams, cb) {
    var me = this;
    var ticket = args.who.session;
    var api_key = args.who.api_key;
    var ttl = ticket && ticket.ttl();

    var onlong = function (eobj, lticket) {
        if (eobj) return cb(eobj);

        var who  = { ticket: lticket, terminal: args.who.terminal, client_id: args.who.client_id };

        return me.checkAccess({ ip: args.how.ip, ticket: lticket, what: args.what }, function (eobj) {
            if (eobj) return cb(eobj);
            return me.soaRequest( args.what, who, args.how, cb );
        });
    };

    var onshort = function (eobj, sticket) {
        if (eobj) return cb(eobj);
        logparams.user_id = sticket.user_id;
        return me.getLongTicket( sticket, onlong );
    };

    if (ticket && ttl >= 0) {
        return this.renewTicket(ticket, ttl, function (eobj, newticket) {
            if (eobj) return cb(eobj);
            if (newticket) args.how.new_session(newticket);

            return onshort( null, newticket || ticket );
        });
    }
    else if (api_key) {
        return this.apikeyLogin( api_key, onshort );
    }
    else {
        return onlong( null, null );
    }
};

// Given a (valid!) short-form ticket, get a newer one, if needed
Emitter.prototype.renewTicket = function (ticket, ttl, cb) {
    var me = this;
    if (ttl >= 300) return cb(null, null);

    var cmd = { subsys: 'authn', pass: { invalid: 1 }, pass_as: 'authn', action: 'User.updateSession', version: 1 };
    return me.internal_soa_request(cmd, { SESSION: ticket.string }, function (eobj, ret) {
        if (eobj) return cb(eobj);
        ticket = tickets.verify(ret.session);
        if (!ticket) return cb({ code: 'internal', msg: 'authn returned bogus ticket', data: { dispatch_failure: true } });
        return cb(null, ticket);
    });
};

// Given an api key, get a short-form ticket
Emitter.prototype.apikeyLogin = function (api_key, cb) {
    var me = this;
    if (! /^[a-zA-Z0-9]+-[a-zA-Z0-9]+$/.test(api_key) )
        return cb({ code: 'authn', msg: 'Invalid apikey.  Must be in format xxx-xxxxxx' });

    var ticket = this.apiKeyCache.get( api_key );
    if (ticket && !ticket.expired())
        return cb(null, ticket);

    var m = api_key.split('-');

    var cmd = { subsys: 'authn', action: 'User.login', version: 1, pass_as: 'authn',
                pass: { credentials: 1, terminal_required: 1, terminal_suspended: 1, terminal_invalid: 1 } };
    return me.internal_soa_request(cmd, { type: 'apikey', keystring: m[0], secret: m[1] }, function (eobj, ret) {
        if (eobj) return cb(eobj);

        if (!(ticket = tickets.verify(ret.session)))
            return cb({ code: 'internal', msg: 'authn returned bogus ticket', data: { dispatch_failure: true } });

        me.apiKeyCache.set( api_key, ticket );
        return cb(null, ticket);
    });
};

// given short ticket, get long (with priv info)
Emitter.prototype.getLongTicket = function(shortticket, cb) {
    var me = this;
    var longticket = me.authzTickets.get( shortticket.string );

    if (longticket && !longticket.expired())
        return cb(null, longticket);

    var cmd = { action: 'Auth.authorize', version: 1, subsys: 'authz', pass: { invalid: 1 }, pass_as: 'authn' };
    return me.internal_soa_request(cmd, { ticket: shortticket.string }, function (eobj, ret) {
        if (eobj) return cb(eobj);

        longticket = tickets.verify(ret.ticket);
        if (!longticket || !longticket.privs)
            return cb({ code: 'internal', msg: 'authz returned bogus ticket', data: { dispatch_failure: true } });

        me.authzTickets.set( shortticket.string, longticket );
        return cb(null, longticket);
    });
};

// just do policy checks
Emitter.prototype.checkAccess = function(args, cb) {
    var me = this;
    if (Date.now() > me.authzTime)
    {
        var cmd = { action: 'Auth.getAuthzTable', version: 1, subsys: 'authz', pass: {} };
        return me.internal_soa_request(cmd, {}, function (eobj, ret) {
            if (eobj) return cb(eobj);

            if (!Object.keys(ret).every(function (act) {
                if (!(ret[act] instanceof Array)) return false;
                if (!ret[act].every(function (s) { return s === null || typeof s == 'string'; })) return false;
                return true;
            })) return cb({ code: 'internal', msg: 'Authz server returned invalid table', data: {dispatch_failure: true} });

            me.authzTables = ret;
            me.authzTime = Date.now() + 300 * 1000;
            return me.checkAccess(args, cb);
        });
    }

    var quotaError = this.ipRate.checkQuota( args.ip );

    if( quotaError ) return cb({ code: 'ratelimit', msg: 'Exceeded Query Limit' });

    var action = args.what.action;
    var real_info = this.requester.serviceMgr.findAction( action, args.what.envelope, args.what.version || 1 );

    if (!real_info)
        return cb({ code: 'no_action', msg: 'No such action ' + action, data: { dispatch_failure: true } });

    if (real_info.flags.indexOf('noauth') < 0) {
        if (!args.ticket)
            return cb({ code: 'authn', msg: 'Need valid session or api key for ' + real_info.action });

        var need = this.authzTables[ real_info.action.toLowerCase() ];
        if (!need)
            return cb({ code: 'internal', msg: 'Unconfigured action ' + real_info.action, data: {dispatch_failure: true} });

        var missing;
        var privs = args.ticket.privs;
        need.forEach(function (n) { if (!privs[n]) missing = n; });

        if (missing)
            return cb({ code: 'authz', msg: 'Access denied - action ' + real_info.action +
                ' requires privilege ' + (this.authzTables._NAMES[missing] || missing) });
    }

    return cb(null);
};

// Executes a SOA request with logging.
Emitter.prototype.soaRequest = function(what, who, how, cb) {
    var params = {
        header:     {
            envelope:   what.envelope,
            action:     what.action,
            version:    what.version || 1,
        },
    };
    if (who.terminal) params.header.terminal = who.terminal;
    if (who.ticket) params.header.ticket = who.ticket.string;
    if (who.ticket && !who.ticket.client_id && who.client_id) { params.header.client_id = who.client_id; }

    soa.debug('low-level', what);

    this.requester.makeRequest(params, what.payload, function(err, soa_res) {

        if (err) return cb({ code: 'transport', msg: util.safeStr(err) });

        var h = soa_res.header;
        if (h.error_code) {
            return cb({ code: h.error_code, msg: h.error, data: h.error_data });
        }

        return cb(null, soa_res);
    });
};

Emitter.prototype.internal_soa_request = function( cmd, payload, callback ) {

    var params = {
        action:   cmd.action,
        envelope: 'json',
        version:  cmd.version,
    };
    if (payload.SESSION) {
        params.ticket = payload.SESSION;
        delete payload.SESSION;
    }

    this.requester.makeRequest( params, new Buffer( JSON.stringify(payload)) , function response( err, soa_res ) {
        var onerr = function (code, msg) {
            if (cmd.pass === true || cmd.pass[code]) {
                return callback({ code: cmd.pass_as || code, msg: msg, data: cmd.pass_as ? null : meta });
            } else {
                return callback({ code: 'internal', msg: 'Unable to contact ' + cmd.subsys + ' server: ' + msg, data: { dispatch_failure: true } });
            }
        };
        if(err){
            soa.error('internal request failed',err);
            return onerr('transport', util.safeStr(err), null);
        } else {
            var acc = [];
            soa_res.on('data', function (d) { acc.push(d); });
            soa_res.on('end', function () {
                if (soa_res.error)
                    return onerr('transport', util.safeStr(soa_res.error), null);
                if (soa_res.header.error_code)
                    return onerr(util.safeStr(soa_res.header.error_code), util.safeStr(soa_res.header.error), soa_res.header.error_data);

                var resp = Buffer.concat(acc).toString();
                try {
                    resp = JSON.parse(resp);
                } catch (e) {}

                if (!resp || 'object' != typeof resp)
                    return onerr('transport', 'failed to parse JSON response', null);

                return callback(null, resp);
            });
        }
    });
};
