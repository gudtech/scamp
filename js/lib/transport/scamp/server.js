var tls          = require('tls'),
    soa          = require('../../index.js'),
    conn         = require('./connection.js');

function Server(params) {
    var me = this;
    me._tlssrv = {};

    soa.config().busInfo().service.forEach(function (addr) {
        me._listen(addr, params);
    });
}

Server.prototype._listen = function (addr, params) {
    var me = this;
    var srv = me._tlssrv[addr] = tls.createServer({
        key:  params.key,
        cert: params.cert,
        honorCipherOrder: true,
    }, function (cleartextStream) {

        var proto = conn.wrap(cleartextStream);
        proto.setBaseTimeout( soa.config().val('scamp.server_timeout', 120) * 1000 );
        var count = 0;

        proto.on('message', function (req) {
            var id = req.header.request_id;
            if (req.header.type != 'request') return soa.error('Received non-request');
            if (id == undefined) return soa.error('Received request with no request_id');
            count++; proto.setBusy(!!count);

            params.callback( req, function (rpy) {
                rpy.header.type = 'reply';
                rpy.header.request_id = id;
                count--; proto.setBusy(!!count);
                proto.sendMessage(rpy);
            } );
        });

        proto.start();
    });

    var tries = soa.config().val('scamp.bind_tries', 20);

    var listen = function () {
        var pmin = soa.config().val('scamp.first_port', 30100);
        var pmax = soa.config().val('scamp.last_port', 30399);
        var port = pmin + Math.floor(Math.random() * (pmax - pmin + 1));

        if (tries-- <= 0)
            soa.fatal('Could not bind scamp-server socket');

        srv.listen( port, addr, function () {
            params.listen( addr, 'scamp+tls://' + addr + ':' + port );
        } );
    };

    srv.on('error', function (e) {
        if (e.code == 'EADDRINUSE') {
            listen();
        } else {
            soa.error(e);
        }
    });

    listen();
}

exports.create = function (p) { return new Server(p); };
