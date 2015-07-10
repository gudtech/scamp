var soa = require('scamp'),
    crypto = require('crypto'),
    fs = require('fs'),
    string = require('./string'), // TODO: better naming
    pubkey = fs.readFileSync('/etc/SCAMP/auth/ticket_verify_public_key.pem');

function Ticket() {
    this.requester = soa.requester({ ident: 'scamp-ticket' });

    this.authzTables  = null;
    this.authzTime    = -Infinity;
}
module.exports = new Ticket();

Ticket.prototype.verify = function (ticket) {
    if (!ticket) return null;

    ticket = string.safeStr(ticket);

    var parts = ticket.split(',');

    if (parts[0] != '1') return null;

    var sig = new Buffer(parts.pop().replace(/-/g,'+').replace(/_/g,'/'), 'base64');

    if (!crypto.createVerify('sha256').update( new Buffer(parts.join(',')) ).verify( pubkey, sig ))
        return null;

    var obj = {
        version: Number(parts[0]),
        user_id: Number(parts[1]),
        client_id: Number(parts[2]),
        validity_start: Number(parts[3]),
        validity_length: Number(parts[4]),
        string: ticket,

        ttl: ttl,
        expired: expired,
    };

    if (parts[5] !== undefined) {
        var h = {};
        parts[5].split('+').forEach(function (priv) { h[priv] = true; });
        obj.privs = h;
    }

    return obj.expired() ? null : obj;
};

Ticket.prototype.checkAccess = function(args, cb) {
    var me = this;
    if (Date.now() > me.authzTime)
    {
        var cmd = { action: 'Auth.getAuthzTable', version: 1, envelope: 'json' };
        return me.requester.makeJsonRequest(cmd, {}, function (err_code, err, ret) {
            if (err) return cb(err);

            if (!Object.keys(ret).every(function (act) {
                if (!(ret[act] instanceof Array)) return false;
                if (!ret[act].every(function (s) { return s === null || typeof s == 'string'; })) return false;
                return true;
            })) return cb(new Error('Authz server returned invalid table'));

            me.authzTables = ret;
            me.authzTime = Date.now() + 300 * 1000;
            return me.checkAccess(args, cb);
        });
    }

    var real_info = me.requester.serviceMgr.findAction( args.action.name, args.action.envelope, args.action.version || 1 );

    if (!real_info)
        return cb(new Error('No such action ' + args.action.name));

    if (real_info.flags.indexOf('noauth') < 0) {
        if (!args.ticket)
            return cb(new Error('Need valid ticket for ' + real_info.action));

        var need = me.authzTables[ real_info.action.toLowerCase() ];
        if (!need)
            return cb(new Error('Unconfigured action ' + real_info.action));

        var missing;
        var privs = args.ticket.privs || {};
        need.forEach(function (n) { if (!privs[n]) missing = n; });

        if (missing)
            return cb(new Error('Access denied - action ' + real_info.action +
                ' requires privilege ' + (me.authzTables._NAMES[missing] || missing)));
    }

    return cb(null);
};

function ttl() {
    var now = Math.floor(Date.now() / 1000);
    return this.validity_length - (now - this.validity_start);
}

function expired() {
    var now = Math.floor(Date.now() / 1000);
    var ttl = this.validity_length - (now - this.validity_start);

    return (now < this.validity_start || ttl <= 0);
}
