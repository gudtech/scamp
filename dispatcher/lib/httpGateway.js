'use strict';

var ap = require('argparser')
         .vals('pidfile')
         .nonvals('debug')
         .parse();

if (ap.opt('pidfile'))
    require('fs').writeFileSync(ap.opt('pidfile'), process.pid);

var soa = require('scamp');
soa.logger().configure({ tag: 'httpgateway', defname: 'httpgateway', debug: ap.opt('debug') });

console.error( 'Starting HTTP gateway - ' + (new Date).toString() );

var cfg = soa.config(),
    req = soa.requester({ ident: 'httpgateway', sector: 'web' }),
    url = require('url'),
    util = require('./util'),

    shutdown = new (require('./shutdown'))({});


function Gateway(req, host_groups) {
    this.host_groups = host_groups;
    this.req = req;
}

Gateway.prototype.handler = function (http_req, http_res) {
    var hold = shutdown.hold('HTTP request for '+http_req.url+' from '+http_req.connection.remoteAddress);
    var start = new Date();
    var logrec = {
        remote_ip: http_req.connection.remoteAddress,
        remote_port: http_req.connection.remotePort,
        date: start,
        url: http_req.url,
        user_agent: http_req.headers['user-agent'],
    };
    var done_called = 0;
    var done = function () {
        if (done_called++) { return; }
        logrec.duration = (new Date() - start) / 1000;
        logrec.status = http_res.statusCode;
        //httplog.log(logrec);   XXX I'd rather not clobber the dispatcher's log
        hold.release();
    };
    http_res.on('end', done); // node versions incompatibility ~sigh~
    http_res.on('finish', done);

    if (shutdown.started) {
        http_res.writeHead(503, { 'Content-Type': 'text/plain', 'Connection': 'close' });
        http_res.write('This dispatcher instance is being shut down.');
        http_res.end();
        return;
    }

    var parst = url.parse(http_req.url);

    // Map parst.pathname back to a SOA action

    // Set up CGI/PSGI headers

    // SOA call

    soa.debug('Request', http_req.url );

    var split = this.findAction(parst.pathname || '');

    if (!split) {
        return error(http_res, 404, 'No such handler');
    }

    var addr = http_req.connection.address();
    var cgi_hash = {
        REQUEST_METHOD: http_req.method,
        SCRIPT_NAME: split[1],
        PATH_INFO: unescape(split[2]),
        QUERY_STRING: parst.query || '',
        REMOTE_ADDR: http_req.connection.remoteAddress,
        REMOTE_PORT: http_req.connection.remotePort,
        SERVER_NAME: addr.address,
        SERVER_PORT: addr.port,
        SERVER_PROTOCOL: 'HTTP/' + http_req.httpVersion,
        REQUEST_URI: http_req.url,
    };

    Object.keys(http_req.headers).forEach(function (h) {
        var h_cgi = 'HTTP_' + h.toUpperCase().replace(/-/g,'_');

        if (h_cgi == 'HTTP_CONTENT_LENGTH') h_cgi = 'CONTENT_LENGTH';
        if (h_cgi == 'HTTP_CONTENT_TYPE') h_cgi = 'CONTENT_TYPE';

        cgi_hash[h_cgi] = http_req.headers[h];
    });

    var msg = new (soa.module('handle/Message'))({
        action: split[0], version: 1, envelope: 'web',
        cgi_headers: cgi_hash, psgi_scheme: this.scheme,
    });

    this.req.forwardRequest({}, msg, function(err, soa_res, svc) {
        if (err) {
            // transport error, 502
            return error(http_res, 502, util.safeStr(err));
        }
        else {
            // if soa_rpy contains a generic error, output it
            // else copy headers from soa_rpy and pipe the data
            if (soa_res.header.error_code)
                return error(http_res, 400, util.safeStr(soa_res.header.error));

            var hout = {};
            var hkey = {};
            var status = +soa_res.header.http_status || 200;
            var l = Array.isArray(soa_res.header.http_headers) ? [].concat(soa_res.header.http_headers) : [];

            while (l.length) {
                var key = util.safeStr(l.shift());
                var val = util.safeStr(l.shift());

                key = (hkey[key.toLowerCase()] || (hkey[key.toLowerCase()] = key));

                (hout[key] || (hout[key] = [])).push(val);
            }

            http_res.writeHead( status, hout );

            soa_res.pipe(http_res);
        }
    });

    http_req.pipe(msg);
};

Gateway.prototype.findAction = function (pathname) {
    var bits = pathname.split('/');
    var unus = [];

    while (bits.length) {
        var action = bits.map(function(s) { return unescape(s).replace(/\..*/,''); }).filter(function (s) { return s.length; }).join('.');

        for (var i = 0; i < this.host_groups.length; i++) {
            var info = this.req.serviceMgr.findAction(this.host_groups[i] + '.' + action, 'web', 1);

            if (info) {
                return [info.action, bits.join('/'), [''].concat(unus).join('/')];
            }
        }

        unus.unshift(bits.pop());
    }

    return null;
};

function error(res, status, msg) {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(msg);
}

// create listeners based on config file

var i=0;

while (true) {
    var port = cfg['httpgateway.listener.'+i+'.port'];
    var groups = cfg['httpgateway.listener.'+i+'.groups'];
    if (!groups) break;
    groups = groups.split(/\s*,\s*/);
    // TODO: SSL

    var g = new Gateway( req, groups );
    g.scheme = 'http';
    var h = require('http').createServer( g.handler.bind(g) );
    console.log('Listening for groups',groups,'on port',port);
    h.listen(port);
    i++;
}

if (!i) {
    console.error('>> You have no httpgateway.listener.0.port in your soa.conf <<');
    process.exit();
}
