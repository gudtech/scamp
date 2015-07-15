'use strict';
// scamp/lib/handle/service.js

var soa           = require('../index.js');

exports.create = function(text, fingerprint){ return new Service(text, fingerprint); };

function Service( text, fingerprint ) {
    var me = this;
    var ref = JSON.parse(text);

    me.orig = ref;
    me.fingerprint = fingerprint;

    if (Array.isArray(ref)) {
        // v3-type packets

        if ( ref.length !== 9 )  throw "invalid number of elements in v3 packet";
        if ( ref[0]     !== 3 )  throw "unknown v3 protocol version: " + ref[0];

        if (Array.isArray(ref[6]) && ref[6].length && typeof ref[6][ref[6].length-1] === 'object') {
            me.ref = ref[6].pop();
        }
        else {
            me.ref = {};
        }

        me.ref.vmaj = ref[0];
        me.ref.ident = ref[1];
        me.ref.wgt = ref[3];
        me.ref.intvl = ref[4];
        me.ref.uri = ref[5];
        me.ref.sector = ref[2]; // default
        me.ref.env = ref[6]; // default
        me.ref.v3actions = ref[7];
        me.ref.ts = ref[8];

        ref = me.ref;
    }
    else {
        me.ref = ref;
    }

    if (typeof ref !== 'object') throw 'invalid announce packet: must be object';
    if (typeof ref.vmaj !== 'number' || !(ref.vmaj <= 4)) { me.badVersion = true; return; }
    if (typeof ref.ident !== 'string') throw 'workerIdent is required';

    me.workerIdent = fingerprint + '$' + ref.ident;
    me.address = ref.uri;
    me.weight = ref.wgt;
    me.sendInterval = ref.intvl;
    me.timestamp = ref.ts;
    if (typeof me.timestamp !== 'number' || isNaN(me.timestamp)) throw 'timestamp must be number';

    me.actions = [];

    if (ref.v3actions) {
        // v3-compatible action list: all actions must have the same sector and envelope list
        if (typeof ref.sector !== 'string') throw 'sector must be string';

        ref.v3actions.forEach(function (perns) {
            perns = perns.slice();
            var ns = perns.shift();
            if (typeof ns !== 'string') throw 'namespace must be string';

            perns.forEach(function (ac) {
                if (!Array.isArray(ac) || ac.length < 1) throw 'action must be array >0 length';
                me.actions.push({
                    sector: ref.sector,
                    namespace: ns,
                    name: String(ac[0]),
                    flags: String(ac[1]) ? String(ac[1]).split(',') : [],
                    envelopes: ref.env,
                    version: ac.length >= 3 ? Number(ac[2]) : 1,
                });
            });
        });
    }

    if (ref.acname) {
        me.loadV4Actions();
    }
}

Service.prototype.loadV4Actions = function () {
    var me = this;
    var len = me.lenRLE('acname');
    if (len > 100000) throw 'action list too long'; // DOS hardening

    var actionL    = me.fromRLE('acname','s',len);
    var actnsL     = me.fromRLE('acns','s',len);
    var compatverL = me.fromRLE('accompat','i',len,1);
    var actverL    = me.fromRLE('acver','i',len,1);
    var actflagL   = me.fromRLE('acflag','s',len,'');
    var actenvL    = me.fromRLE('acenv','s',len);
    var actsecL    = me.fromRLE('acsec','s',len);

    while (actionL.length) {
        var action = actionL.shift();
        var compatver = compatverL.shift();
        var actver = actverL.shift();
        var actflag = actflagL.shift();
        var actenv = actenvL.shift();
        var actsec = actsecL.shift();
        var actns = actnsL.shift();

        if (compatver != 1) continue;

        me.actions.push({
            sector: actsec,
            namespace: actns,
            name: action,
            flags: actflag ? actflag.split(',') : [],
            envelopes: actenv.split(','),
            version: actver,
        });
    }
};

Service.prototype.lenRLE = function (name) {
    if (!this.ref[name]) throw name + ' is required';
    if (!Array.isArray(this.ref[name])) throw name + ' must be array';

    var len = 0;

    this.ref[name].forEach(function (ent) {
        if (Array.isArray(ent)) { len += ent[0]; } else { len++; }
    });

    return len;
};

Service.prototype.fromRLE = function (name, type, len, deflt) {
    var rle = this.ref[name];
    if (rle === undefined) {
        if (deflt === undefined) {
            throw name + ' must be provided';
        }
        else {
            rle = [ [ len , deflt ] ];
        }
    }

    var out = [];
    rle.forEach(function (ent) {
        var obj = ent,ct = 1;
        if (Array.isArray(ent)) {
            if (ent.length !== 2) throw name + ' array entry must be 2-element';
            ct = ent[0]; obj = ent[1];
        }

        if (typeof ct !== 'number' || ct !== (0|ct) || ct < 0) {
            throw 'invalid repeat count ' + ct;
        }
        if (ct + out.length > len) { throw 'repeat count overflow'; }

        if (type === 's' && typeof obj !== 'string') { throw name + ' elements must be strings'; }
        if (type === 'i' && (typeof obj !== 'number' || obj !== (0|obj) || obj <= 0)) { throw name + ' elements must be positive integers'; }

        for (var i = 0; i < ct; i++) { out.push(obj); }
    });

    return out;
};

var authorized_keys_cache = {};
var authorized_keys_timestamp = -1e100;
var authorized_keys_current = false;
var authorized_keys_name = soa.config().val('bus.authorized_services');
var fs = require('fs');

function authorized_keys() {
    // kind of meh to use readFileSync here but it should be well pinned in cache
    if (authorized_keys_current) return authorized_keys_cache;
    var ts = +fs.statSync(authorized_keys_name).mtime;
    if (ts != authorized_keys_timestamp) {
        var file = fs.readFileSync(authorized_keys_name, 'utf8');
        authorized_keys_cache = {};

        file.split('\n').forEach(function (line) {
            line = line.replace(/#.*/,'').trim();
            if (!line) return;

            var match = /^(\S*)(.*)$/.exec(line);
            var fingerprint = match[1];
            var tok_rx = match[2].split(',')
                .map(function (t) { return t.trim().replace(/[\^$\\.*+?()[\]{}|]/g,'\\$&'); })
                .map(function (t) { return /:/.test(t) ? t.replace(/:ALL$/,':.*') : "main:"+t; })
                .join('|');

            authorized_keys_cache[fingerprint] = new RegExp("^(?:"+tok_rx+")(?:\\.|$)","i");
        });
        authorized_keys_timestamp = ts;
    }

    authorized_keys_current = true;
    process.nextTick(function () { authorized_keys_current = false; });
    return authorized_keys_cache;
}

Service.prototype.authorized = function (sector, action) {
    var rx = authorized_keys()[this.fingerprint];
    if (/^_meta\./.test(action)) return true; // every service is competent to questions about itself
    if (/:/.test(sector) || /:/.test(action)) return false; // nice try
    if (!rx) {
        //if (!this.unauth_warn) soa.error('Unauthorized service',this.fingerprint);
        this.unauth_warn = {};
        return false;
    }
    this.unauth_warn = this.unauth_warn || {};
    if (rx.test(sector+':'+action)) return true;
    if (!this.unauth_warn[action]) {
        this.unauth_warn[action] = true;
        //soa.error('Service',this.fingerprint,'not authorized to provide',action);
    }
    return false;
};
