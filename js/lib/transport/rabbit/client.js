
// scamp/lib/protocol/rabbit/client.js

var amqp         = require('amqp'),
    crypto       = require('crypto'),
    TIMEOUT      = 30000,                 //time to wait for response in ms
    CONTENT_TYPE = 'application/json';

exports.connect = function(params) {
    
    return new RabitRPC({
            host: 'rabbit.in.gudtech.com'
        },{});
}

function RabitRPC(params, opts){
    var me = this;
    
    me.pendingRequests = {};
    me.conn = amqp.createConnection(params, opts, function(){
        me.exchange = me.conn.exchange('', {},function(){
            me.conn.queue('', { exclusive:true }, function(q){
                me.queueName = q.name; //store the name
                me.isReady = true;
                
                q.subscribe(function(message, headers, deliveryInfo, m){
                    var id   = m.correlationId,
                        req  = me.pendingRequests[id];
                        
                    if (!req) return;
                    delete me.pendingRequests[id];
                    
                    clearTimeout( req.t );
                    req.cb( null, message ); 
                });
            });
        });
    });
    
    
}

function _timeout( reqs, id ){
    var req = reqs[ id ];
    req.cb( new Error( "RPC Timeout (request " + id + ")" ) );
    delete reqs[ id ];
}

RabitRPC.prototype.request = function( routingKey, content, callback, params ){
    var me = this;
        id = crypto.randomBytes(16).toString('hex');  //generate a unique correlation id for this call
        
    params = params || {};
    
    me.pendingRequests[ id ] = {
        cb: callback,
        t:  setTimeout( _timeout, TIMEOUT, me.pendingRequests, id )
    };
    
    me.exchange.publish( routingKey ,  content, {
        correlationId:  id,
        contentType:    params.contentType || CONTENT_TYPE,
        replyTo:        me.queueName
    });
}


