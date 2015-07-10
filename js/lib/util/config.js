/*

=head1 NAME

util/config.js - configuration subsystem for scamp

=head1 SYNOPSYS

    soa.config().soaAddr();
    soa.config().cache_ping_interval;

=head1 DESCRIPTION

This module implements reading of the B</etc/SCAMP/soa.conf> file, or an
alternate file specified by the B<SCAMP> environment variable.  The file is
formatted as key-value pairs, one per line, with optional blank lines and
comments introduced by C<#>.  Keys and values are separated by C<=>.
Additionally a number of methods are exported.

=head1 METHODS

=head2 busInfo()

=cut

*/

var fs   = require('fs'),
    os   = require('os'),
    soa  = require('../index.js'),
    used = {},
    conf = '',
    path = process.env['SCAMP'] || '/etc/SCAMP/soa.conf',
    values = {
    };

try {
    conf = fs.readFileSync(path, 'utf8');
} catch (ex) {
    if (ex.code != 'ENOENT') {
        soa.error('Failed to read config file!', aex);
    }
}

var _interfaces;
function interfaces() {
    if (_interfaces) return _interfaces;
    _interfaces = [];

    var rawifs = os.networkInterfaces();
    Object.keys(rawifs).forEach(function (dev) {
        rawifs[dev].forEach(function (addr) {
            if (addr.family != 'IPv4') return;
            _interfaces.push(addr.address);
            _interfaces[dev + '$'] = addr.address;
        });
    });

    return _interfaces;
}

var addrMatch = [ /^10\./, /^192\.168\./ ];
var probedAddr;
function probeInterface() {
    if (!probedAddr) {
        addrMatch.some(function (pattern) {
            probedAddr = interfaces().filter(function(a) { return pattern.test(a); })[0];
            if (probedAddr) return true;
        });
        if (!probedAddr)
            soa.fatal('No suitable address found in bus.address autoprobe');
    }
    return [probedAddr];
}

conf.split('\n').forEach(function (line) {
    line = line.replace(/#.*/, '').trim();
    if (!line) return;

    var ix = line.indexOf('=');
    if (ix < 0) {
        soa.error('Config line has no equals:', line);
        return;
    }

    var variable = line.substring(0, ix).trim(),
        value    = line.substring(ix+1).trim();

    if (used[variable]) {
        soa.error('Duplicate config variable, using first instance:',variable);
        return;
    }
    used[variable] = true;
    values[variable] = value;
});

module.exports = values;

values.busInfo = function() {
    return {
        discovery: values.addressListVal('discovery.address') || values.addressListVal('bus.address') || probeInterface(),
        service:  values.addressListVal('service.address') || values.addressListVal('bus.address') || probeInterface(),
        port:  values['discovery.port'] || 5555,
        group: values['discovery.multicast_address'] || '239.63.248.106',
    };
};

values.val = function(name, def) {
    if (this[name] === undefined && def === undefined) {
        soa.fatal('Value required for', name);
    }
    return this[name] === undefined ? def : this[name];
};

// returns false in lieu of an empty list to make fallbacking easier
values.addressListVal = function (name) {
    var addrs = [];

    this.val(name, '').split(',').map(function (raw) {
        raw = raw.trim();
        if (!raw) return;
        var addr;

        if (/^if:/.test(raw)) {
            addr = interfaces()[ raw.substring(3) + '$' ];
        } else if (interfaces().indexOf(raw) >= 0) {
            addr = raw;
        }

        if (addr)
            addrs.push(addr);
        else
            soa.error("Cannot resolve",raw,"to an interface");
    });

    return addrs.length ? addrs : false;
};
