var util = require('../util');

function ExtDirect(params) {
    this.wc = params.wc;
    this.emit = params.emit;
    var me = this;
    this.emit.requester.serviceMgr.on('changed', function () { this.routes = this.actions = null;}.bind(this));
}
module.exports = ExtDirect;

ExtDirect.prototype.refresh = function() {
    if (this.actions) return;

    var actions = this.emit.requester.serviceMgr.listActions();
    this.actions    = {};
    this.routes = {};
    actions.forEach(function (actinfo) {
        var path    = actinfo[0];
        var version = actinfo[1];
        var parts   = path.split('.');
        var head    = parts.pop();
        var ns      = parts.join('');

        if (version != 1) ns = ns + 'V' + version;

        var rt  = this.routes[ns+'$'] = this.routes[ns+'$'] || {};
        var api = this.actions[ns] = this.actions[ns] || [];

        rt[head+'$'] = path;
        api.push({ len: 1, name: head });
    }, this);
};

ExtDirect.prototype.api = function(mined, http_req, http_res) {
    var basepath = util.safeStr(mined.data.basepath || '');
    var namespace = util.safeStr(mined.data.namespace || '');
    var setvar = util.safeStr(mined.data['var'] || 'Ext.app.REMOTING_API');

    var url = '/extdirect/dispatch';
    if (/^\/\w+$/.test(basepath)) url = basepath + url;

    this.refresh();
    var api = {
        url:     url,
        type:    'remoting',
        actions: this.actions,
    };

    if (namespace && /^\w+(\.\w+)?$/.test(namespace)) api.namespace = namespace;

    if (!/^[\w\.]+$/.test(setvar)) return this.wc.raw_error(http_res, 400, 'Bad Request', 'Invalid var parameter');

    http_res.writeHead(200, {'Content-Type': 'application/javascript'});
    http_res.end( setvar + " = " + JSON.stringify(api) + ";", 'utf8' );
};

ExtDirect.prototype.dispatch = function(mined, http_req, http_res) {
    var data = mined.data;
    var who  = mined.who;
    var how  = mined.how;
    if (!(data instanceof Array))
        data = [ data ];
    how.ingress = 'extdirect';

    var pending = data.length;
    var results = [];

    if (!pending) {
        http_res.writeHead(200, {'Content-Type': 'application/json'});
        http_res.end('[]', 'utf8');
        return;
    }

    if (!data.every(function (rq) { return rq instanceof Object; }))
        return this.wc.raw_error(http_res, 400, 'Bad Request', 'Ext/Direct requests must be objects');

    this.refresh();
    Object.keys(data).forEach(function (k) {
        var request = data[k];
        var done = function (val) {
            if (results[k]) { soa.error("Done called twice?"); return; }

            results[k] = val;
            pending--;

            if (!pending) {
                http_res.writeHead(200, {'Content-Type': 'application/json'});
                http_res.end(JSON.stringify(results), 'utf8');
            }
        };

        var action = util.safeStr(request.action || '');
        var method = util.safeStr(request.method || '');

        var cooked_err = function (code, err) {
            done({
                type: 'exception',
                tid: request.tid,
                message: err,
                error_code: code,
            });
        };

        var cooked_res = function (res) {
            done({
                type: 'rpc',
                tid: request.tid,
                action: request.action,
                method: request.method,
                result: res,
            });
        };

        if (!action) {
            cooked_err('missing', 'Missing action');
        } else if (!method) {
            cooked_err('missing', 'Missing method');
        } else if (!this.routes[action+'$']) {
            cooked_err('invalid', "Invalid action '" + action + "'");
        } else if (!this.routes[action+'$'][method+'$']) {
            cooked_err('invalid', "Invalid method '" + method + "'");
        } else {
            this.emit.auth_request({
                who:  who,
                how:  how,
                what: {
                    envelope: 'json',
                    action: this.routes[action+'$'][method+'$'],
                    params: ((request.data instanceof Array) ? request.data[0] : request.data) || {},
                    version: 1
                }
            }, function (eobj, soa_res) {
                if (eobj) {
                    // prompt error
                    cooked_err(eobj.code, eobj.msg);
                } else {
                    var data = [];
                    soa_res.on('data', function (d) { data.push(d); });
                    soa_res.on('end', function () {
                        var json;
                        if (soa_res.error) {
                            cooked_err('general', soa_res.error);
                        } else if (soa_res.header.error_code) {
                            cooked_err(soa_res.header.error_code, soa_res.header.error);
                        } else {
                            try {
                                json = JSON.parse(Buffer.concat(data).toString());
                            } catch (e) {
                                cooked_err('general', 'Bad JSON returned from upstream');
                            }
                            if (json !== undefined) cooked_res(json); // JSON.parse never returns undefined
                        }
                    });
                }
            });
        }
    }, this);
};

ExtDirect.prototype.request = function(path, http_req, http_res) {
    var me = this;
    var onerr = function (eobj) { return me.wc.error( http_res, function(x,y) { return y; }, eobj.code, eobj.msg ); };

    var func;
    if (path == 'extdirect/src') func = me.api;
    if (path == 'extdirect/dispatch') func = me.dispatch;
    if (!func) return false;

    return me.wc.slurpBytes( http_req, function (eobj, data) {
        if (eobj) return onerr(eobj);
        return me.wc.mineJson( http_req, http_res, data, function (eobj, who, how, data) {
            if (eobj) return onerr(eobj);
            return func.call(me, { who: who, how: how, data: data }, http_req, http_res);
        });
    });
};
