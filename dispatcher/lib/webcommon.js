
var tickets = require('./emit/ticket'),
    cookie = require('cookie'),
    querystring = require('querystring'),
    tickets = require('./emit/ticket'),
    url = require('url'),
    util = require('./util'),
    soa = require('scamp');

function WebCommon(params) {
    this.emit = params.emit;
}
module.exports = WebCommon;

var code_to_http = {
    internal: [ 500, 'Internal server error' ],
    authn: [ 403, 'Forbidden' ], // we cannot use 401 unless we support WWW-Authenticate
    authz: [ 403, 'Forbidden' ],
    ratelimit: [ 429, 'Too Many Requests' ],
    no_action: [ 404, 'Not Found' ],
    transport: [ 502, 'Bad Gateway' ], // could also be 503 (unavailable, Retry-After) or 504 (timeout)
    request_too_big: [ 413, 'Request Entity Too Large' ],
    bad_request: [ 400, 'Bad Request' ],
};

// in the common case where the result of an authorized request is sent directly
// to an http client, use this:
WebCommon.prototype.auth_request_http = function(args, http_res) {
    var me=this;

    this.emit.auth_request(args, function (eobj, soa_res) {
        if (eobj) {
            return me.error( http_res, args.how.cooker, eobj.code, eobj.msg );
        } else {
            if (soa_res.header.new_session)
                args.how.new_session(tickets.verify(soa_res.header.new_session));
            if (soa_res.header.new_terminal && args.how.new_terminal)
                args.how.new_terminal(soa_res.header.new_terminal);
            if (soa_res.header.error_code)
                return me.error( http_res, args.how.cooker, soa_res.header.error_code, soa_res.header.error );

            var hdr = {'Content-Type': 'application/json'};
            if (http_res.gtCORS){
                hdr['Access-Control-Allow-Origin'] = '*';
                hdr['Access-Control-Expose-Headers'] = 'X-New-Session, X-New-Terminal';
            }
            http_res.writeHead(200, hdr);
            soa_res.pipe( http_res ); // if an error occurs in the middle of this... sucks
        }
    });
};

WebCommon.prototype.raw_error = function(http_res,code, codemsg, error, headers){
    headers = headers || {};
    if (http_res.gtCORS){
        headers['Access-Control-Allow-Origin'] = '*';
        headers['Access-Control-Expose-Headers'] = 'X-New-Session, X-New-Terminal';
    }
    http_res.writeHead( code, codemsg, headers );
    if(error){
        // protocol specific error handlers here
        http_res.end( JSON.stringify(('object' == typeof error) ? error : { error: error }) + "\r\n" );
    }else{
        http_res.end( "\r\n" );
    }
};

WebCommon.prototype.error = function(http_res, cooker, code, msg) {
    var http_err = code_to_http[code] || [ 400, 'Bad Request' ];
    // ick.  sencha won't properly handle "errors" unless it thinks the operation succeeded...
    return this.raw_error( http_res, 200, http_err[1], cooker( code, msg ), { 'Content-Type': 'application/json' } );
};

// Gets all data from the client as a buffer.
WebCommon.prototype.slurpBytes = function (http_req, cb) {
    var accum = [],
        me    = this,
        size  = 0;

    http_req.on('data', function (bits) {
        if (!accum) return;
        accum.push(bits);
        size += bits.length;

        if (size > 1048576) { accum = null; return cb({ code: 'request_too_big', msg: 'Request body is too large' }); }
    });
    http_req.on('end', function () {
        if (!accum) return;
        return cb( null, accum ? Buffer.concat(accum, size) : null );
    });
};


// Gets all data from the client following the conventions used by the current json-based fronts.
WebCommon.prototype.mineJson = function (req, res, data, cb) {
    var ctype = req.headers['content-type'];
    soa.debug("Content-type:", ctype);

    var json_str;
    var url_parts = url.parse(req.url);
    var p = querystring.parse(url_parts.query, null, null, {maxKeys: 0});
    var p2;
    var use_session_cookie;

    if (ctype && /application\/json/i.test(ctype)) {
        use_session_cookie = true; // CSRF is impossible with this content-type
        json_str = data.toString();
    } else if (ctype && /application\/x-www-form-urlencoded/i.test(ctype)) {
        p2 = querystring.parse(data.toString(), null, null, {maxKeys: 0});
        Object.keys(p2).forEach(function(k) { p[k] = p2[k]; });
    } else if (p.jsonData) {
        json_str = p.jsonData;
        delete p.jsonData;
    }
    try {
        json = json_str === undefined ? json_str : JSON.parse(json_str);
    } catch (e) {
        return cb({ code: 'bad_request', msg: 'Malformed JSON argument' });
    }

    var params;
    if ( json instanceof Array ) {
        params = json; // overrides params!
    } else if (json instanceof Object) {
        var n = { };
        Object.keys(p).forEach(function (k) { n[k] = p[k]; });
        Object.keys(json).forEach(function (k) { n[k] = json[k]; });
        params = n;
    } else {
        params = p;
    }

    // ridonkulousness on the handheld
    if (req.headers['origin'] && req.headers['origin'] != 'file://') { res.gtCORS = true; use_session_cookie = true; }
    var cookie_hdr = use_session_cookie ? cookie.parse(req.headers.cookie || '') : {};

    var terminal   = cookie_hdr.terminal || req.headers.terminal || params.terminal || '';
    var ticket     = tickets.verify(req.headers.session || params.session || cookie_hdr.session);
    var api_key    = req.headers.apikey  || params.apikey || '';
    var client_id  = req.headers.client_id || params.client_id || '';

    var cookies_out = [];
    var new_session = function(ticket) {
        if (!ticket) return;
        cookies_out.push(cookie.serialize('session', ticket.string, { secure: true, maxAge: ticket.ttl(), path: '/' }));
        res.setHeader('Set-Cookie', cookies_out);
        res.setHeader('X-New-Session', ticket.string);
    };

    var new_terminal = function(token) {
        if (!token) return;
        cookies_out.push(cookie.serialize('terminal', token, { secure: true, maxAge: 10*365*86400, path: '/' }));
        res.setHeader('Set-Cookie', cookies_out);
        res.setHeader('X-New-Terminal', token);
    };

    return cb(null,
        { session: ticket, terminal: util.safeStr(terminal), api_key: util.safeStr(api_key), client_id: util.safeStr(client_id) },
        { ip: req.connection.remoteAddress, port: req.connection.remotePort, user_agent: req.headers['user-agent'],
            new_session: new_session, new_terminal: new_terminal },
        params
    );
};
