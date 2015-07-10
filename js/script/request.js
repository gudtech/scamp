// note, we don't use the normal client here because we want to make low-level requests to specific targets

var soa           = require('../..'),
    connectionMgr = soa.module('util/connectionMgr'),
    Message       = soa.module('handle/Message');

var ap = require('argparser')
         .vals( 'address', 'envelope', 'version', 'action', 'body' )
         .parse();

['address', 'envelope', 'action'].forEach(function (op) {
    if (ap.opt(op) === false) throw new Error(op + ' is required');
});

var client = connectionMgr.getClient( ap.opt('address') );
if( !client ) throw new Error('bad service address: ' + ap.opt('address') );

var params = {
    envelope:   ap.opt('envelope'),
    version:    ap.opt('version'),
    action:     ap.opt('action'),
};
var request   = new Message( params );

client.request( request, function ( err, response ) {
    if (err) throw err;

    response.on('data', function (b) { console.log(b); process.stdout.write(b); });
    response.on('end', function () { process.exit(); });
});

request.slurp( new Buffer(ap.opt('body') || '') );

setInterval(function () { }, 1000);
