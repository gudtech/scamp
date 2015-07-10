'use strict';
// gt-dispatcher/server.js

var ap = require('argparser')
         .vals('pidfile', 'port')
         .nonvals('debug')
         .parse();

if (ap.opt('pidfile'))
    require('fs').writeFileSync(ap.opt('pidfile'), process.pid);

var soa = require('scamp');
soa.logger().configure({ tag: 'dispatcher', defname: 'dispatcher', debug: ap.opt('debug') });

console.error( 'Starting Dispatcher - ' + (new Date).toString() );

var cfg = soa.config(),
    fs  = require('fs'),
    serverOpts = {
        // to reduce the threat from TLSv1.0's CBC vulnerabilities, we prefer a TLSv1.2-only cipher, a non-CBC block cipher, and a stream cipher.
        // RC4 has been around forever and everyone supports it.
        ciphers: 'ECDHE-RSA-AES128-SHA256:AES128-GCM-SHA256:RC4:HIGH:!MD5:!aNULL:!EDH',
        honorCipherOrder: true,
        key:  fs.readFileSync(cfg['dispatcher.ssl_key_file']),
        cert: fs.readFileSync(cfg['dispatcher.ssl_cert_file']),
        sessionIdContext: require('crypto').randomBytes(16).toString('hex'),
    },
    url = require('url'),
    app = require('https').createServer( serverOpts, handler ),

    shutdown = new (require('./shutdown'))({}),
    httplog = require('./accesslog').httplog,
    emit = new (require('./emit'))({}),
    wc = new (require('./webcommon.js'))({ emit: emit });

var urlStrip   = /(^\/*)|(\/*$)/gi;
function handler (http_req, http_res) {
    var hold = shutdown.hold('HTTP request for '+http_req.url+' from '+http_req.connection.remoteAddress);
    var start = new Date();
    var logrec = {
        remote_ip: http_req.connection.remoteAddress,
        remote_port: http_req.connection.remotePort,
        date: start,
        url: http_req.url,
        user_agent: http_req.headers['user-agent'],
    };
    var done = function () {
        if (!logrec) return;
        logrec.duration = (new Date() - start) / 1000;
        logrec.status = http_res.statusCode;
        httplog.log(logrec);
        logrec = null;
        hold.release();
    };
    http_res.on('end', done); // node versions incompatibility ~sigh~
    http_res.on('finish', done);
    http_res.on('close', done);

    if (shutdown.started) {
        http_res.writeHead(503, { 'Content-Type': 'text/plain', 'Connection': 'close' });
        http_res.write('This dispatcher instance is being shut down.');
        http_res.end();
        return;
    }

    var path = (url.parse(http_req.url).pathname || '').replace(urlStrip, '');
    soa.debug('Request', http_req.url, path );

    for (var i = 0; i < http_handlers.length; i++) {
        if (http_handlers[i].request(path, http_req, http_res) !== false)
            return;
    }
    return wc.raw_error(http_res, 400, 'Bad Request', 'URL format not recognized (missing protocol suffix?)');
}

var http_handlers = 'json jsonstore extdirect robotstxt'.split(' ').map(function (s) { return new (require('./front/'+s))({ wc: wc, emit: emit }) });

var listening = false;

var port = ap.opt('port') || cfg['dispatcher.port'] || 8080;
console.error('Listening on port', port);

setTimeout(function () {
    app.listen(port, function () {
        if (shutdown.started) app.close();
        listening = true;
    });
}, cfg['dispatcher.delay_listen'] || 10000); // give discovery time to happen

shutdown.on('start', function() { if (listening) app.close(); });

var binary_handler = new (require('./front/binaryjs'))({ server: app, emit: emit, shutdown: shutdown });
