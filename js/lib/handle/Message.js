
// scamp/lib/handle/RelayMessage.js

var util   = require('util');
var Stream = require('stream');

module.exports = Message;

function Message(header) {
    Stream.call(this);

    this.readable = true;
    this.writable = true;
    this._paused  = false;

    this.header   = header;
}
util.inherits( Message, Stream );

Message.prototype.write = function( data, encoding ) {
    if (typeof data == 'string')
        return this.write( new Buffer(data, encoding) );
    if (!Buffer.isBuffer(data))
        throw new Error('passed non-string non-buffer to write');

    this.emit('data',data);
    return !this._paused;
};

Message.prototype.pause = function() {
    this._paused = true;
};
Message.prototype.resume = function() {
    if (this._paused) {
        this._paused = false;
        this.emit('drain');
    }
};

Message.prototype.end = function(data, encoding) {
    if (data !== undefined) {
        this.write(data, encoding);
    }

    if ( this.finished ) return false;
    this.finished = true;

    this.emit('end');
};

Message.prototype.slurp = function(data){
    if((typeof data == 'object') && data.readable ){
        data.pipe(this);
    } else {
        this.end(data);
    }
};

/*

=head1 NAME

handle/RelayMessage.js

=head1 DESCRIPTION

Base type for messages in the JS version of the SOA framework.  RelayMessage
objects are read/write node streams which behave as no-op couplers;
additionally, they have headers set at create time and an C<error> property
which is set immediately before end (will be available in 'end' handlers).

*/
