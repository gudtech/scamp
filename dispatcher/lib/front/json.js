var soa = require('scamp');

function JsonFrontend(params) {
    this.wc = params.wc;
}

JsonFrontend.prototype.request = function(path, http_req, http_res) {
    if (!/\.json$/.test(path)) return false;
    var me = this;

    if (http_req.method == 'OPTIONS') {
        http_res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Session, ApiKey, Terminal, Content-Type, X-Requested-With',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Max-Age': 3600,
        });
        http_res.end('');
        return;
    }

    var onerr = function (eobj) { return me.wc.error( http_res, json_cooker, eobj.msg, eobj.code ); };

    return me.wc.slurpBytes( http_req, function (eobj, data) {
        if (eobj) return onerr(eobj);
        return me.wc.mineJson( http_req, http_res, data, function (eobj, who, how, data) {
            if (eobj) return onerr(eobj);

            var action = path.replace(/\.json$/, '').split('/').join('.');

            var version = 1;
            if (/~\d+$/.test(action)) {
                var vsplit = action.split('~');
                version = 0+vsplit.pop();
                action = vsplit.join('~');
            }

            if (! /\./.test(action)) return onerr({ code: 'bad_request', msg: 'Missing namespace on JSON request' });

            soa.debug('json req',action);
            how.ingress = 'json';
            how.cooker  = json_cooker;

            var what = { action: action, version: version, envelope: 'json', params: data };

            return me.wc.auth_request_http( { who: who, how: how, what: what }, http_res);
        });
    });
};

function json_cooker(code, msg) {
    return { ERROR: msg, ERRORCODE: code };
}

module.exports = JsonFrontend;
