
// scamp/lib/index.js

var util = require('util');

exports.module = function( name ) {
    return require('./' + name );
};

exports.config = function( name ){
    return require('./util/config.js');
}
exports.logger = function( name ){
    return require('./util/logger.js');
}
exports.client = function( name ){
    return require('./transport/' + name + '/client.js' );
}
exports.server = function( name ){
    return require('./transport/' + name + '/server.js' );
}

exports.service = function(params){
    return require('./actor/service.js' ).create(params);
}
exports.requester = function(params){
    return require('./actor/requester.js' ).create(params);
}

exports.initClients = function(){
    var l = arguments.length;
    var client;
    while(l--){
        client = arguments[l];
        require( './transport/' + client + '/client' );
    }
}

exports.debug = function() { this.logger().log('debug', arguments); };
exports.info = function() { this.logger().log('info', arguments); };
exports.error = function() { this.logger().log('error', arguments); };
exports.fatal = function() { this.logger().log('fatal', arguments); };
