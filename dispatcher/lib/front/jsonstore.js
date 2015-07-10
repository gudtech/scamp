var util = require('../util');

function JsonStoreFrontend(params) {
    this.wc = params.wc;
}

JsonStoreFrontend.prototype.request = function(path, http_req, http_res) {
    if (!/\.jsonstore$/.test(path)) return false;
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

    var onerr = function (eobj) { return me.wc.error( http_res, jsonstore_cooker.bind({xact:'read'}), eobj.msg, eobj.code ); };

    return me.wc.slurpBytes( http_req, function (eobj, data) {
        if (eobj) return onerr(eobj);
        return me.wc.mineJson( http_req, http_res, data, function (eobj, who, how, data) {
            if (eobj) return onerr(eobj);

            var xact = util.safeStr(data.xaction || 'read');
            var action = path.replace(/\.jsonstore$/, '').split('/').join('.') + '._' + xact;

            how.ingress = 'jsonstore';
            how.cooker  = jsonstore_cooker.bind({ xact: xact });

            var what = { action: action, version: 1, envelope: 'jsonstore', params: data };

            return me.wc.auth_request_http( { who: who, how: how, what: what }, http_res);
        });
    });
};

function jsonstore_cooker(code, msg) {
    var res = { success: false, message: msg, error_code: code };
    if (this.xact == 'read')
        res.metaData = { fields: [], successProperty: 'success', messageProperty: 'message' };
    return res;
}

module.exports = JsonStoreFrontend;
