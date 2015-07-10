
// scamp/lib/util/connectionMgr.js

var soa        = require('../index.js');

module.exports = new Manager();

// Yo, I AM Your manager, B!
function Manager( params ){
    var me = this;
    
    me._cache = {};
    
}

typeMap = {
    'scamp+tls': { transport: 'scamp' },
}
addrRe = /^([a-z0-9+]{2,15}):\/\/(.*)$/;

Manager.prototype.getClient = function( address, fingerprint ){
    var me     = this,
        client = me._cache[ address ];

    if( client ) return client;

    var match  = address.match(addrRe);
    if(!match) return null;

    var transportStr = match[1],
        ref          = typeMap[ transportStr ],
        i = 0, tr;

    if(!ref) return null;

    client = soa.client( ref.transport ).create({
        address: address,
        fingerprint: fingerprint,
    });
    soa.debug('Connect to', address );
    me._cache[ address ] = client;

    if (client.on) client.on('lost', function () { delete me._cache[address]; });

    return client;
}
