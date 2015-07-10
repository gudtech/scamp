'use strict';

var soa = require('scamp'),
    util = require('./util');

function LogFile(soa_param, def_name, fields) {
    this.logname = soa.config().val('dispatcher.'+soa_param, '/var/log/scamp/'+def_name);
    this.logstream = require('fs').createWriteStream(this.logname, { flags: 'a', encoding: 'utf8' });

    this.logstream.on('error', function(err) { soa.fatal('cannot open dispatcher access log', err); });
    this.fields = fields.split(' ');
    this.logstream.write(['#FIELDS'].concat(this.fields).join('\t') + '\n');
}

LogFile.prototype.log = function (values) {
    var line = this.fields.map(function (field) {
        if (!values.hasOwnProperty(field)) throw "values missing "+field;
        var s = values[field];
        delete values[field];
        return field == 'date' ? fancytime(s) : util.safeStr(s == null ? '' : s).replace(/[\t\n]/g,' ').substring(0,255);
    }).join('\t');

    if (Object.keys(values).length) throw "values has extra fields " + Object.keys(values).join(' ');

    this.logstream.write(line + '\n');
};

// date is a special name
var access_log = new LogFile('access_log', 'dispatcher-access.log', 'date requester_ip requester_port user_id action version status error_code error_message request_duration_seconds ingress user_agent request_bytes response_bytes');
var http_log = new LogFile('http_log', 'dispatcher-http.log', 'date remote_ip remote_port url status duration user_agent');

var lasttz, lastfancytz;

function fancytz(tzoff) {
    if (tzoff == lasttz) return lastfancytz;
    lasttz = tzoff;

    var tzabs = Math.abs(tzoff),
        tzhrs = Math.floor(tzabs / 60),
        tzmin = Math.floor(tzabs % 60);

    tzhrs = tzhrs > 9 ? tzhrs : '0' + tzhrs;
    tzmin = tzmin > 9 ? tzmin : '0' + tzmin;

    return lastfancytz = (tzoff < 0 ? '+' : '-') + tzhrs + tzmin; // reversed sign convention. grr
}

function fancytime(time) {
    var m    = time.getMonth() + 1,
        d    = time.getDate(),
        hh   = time.getHours(),
        mm   = time.getMinutes(),
        ss   = time.getSeconds();

    m  = m  > 9 ? m  : '0' + m;
    d  = d  > 9 ? d  : '0' + d;
    hh = hh > 9 ? hh : '0' + hh;
    mm = mm > 9 ? mm : '0' + mm;
    ss = ss > 9 ? ss : '0' + ss;

    return time.getFullYear() + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss + " " + fancytz(time.getTimezoneOffset());
}

exports.fancytime = fancytime;
exports.httplog = http_log;
exports.rpclog = access_log;
