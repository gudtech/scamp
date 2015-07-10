

exports.create = function(params) { return new IP(params) };

function IP ( params ){
    
    var ct,
        maxCount = params.maxCount || 1000,
        interval = params.interval || 1000,
        mrps     = maxCount / ( interval / 1000 )
    
    function reset(){ ct = {} };
    reset();
    setInterval( reset, params.interval || 1000 );
    
    this.checkQuota = function( ip ){
        var ipct = ct[ip] = ( ct[ip] || 0 ) + 1;

        if( ipct > maxCount ) return {
            'X-RateLimit-Exceeded': 'IP',
            'X-Max-Rate-Per-Second': mrps
            };
        return false;
    }
}
