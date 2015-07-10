
var crypto = require('crypto'),
    fs     = require('fs'),
    util   = require('../util'),
    pubkey = fs.readFileSync('/etc/SCAMP/auth/ticket_verify_public_key.pem');

function ttl() {
    var now = Math.floor(Date.now() / 1000);
    return this.validity_length - (now - this.validity_start);
}

function expired() {
    var now = Math.floor(Date.now() / 1000);
    var ttl = this.validity_length - (now - this.validity_start);

    return (now < this.validity_start || ttl <= 0);
}

exports.verify = function (ticket) {

    if (!ticket) return null;
    ticket = util.safeStr(ticket);

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
