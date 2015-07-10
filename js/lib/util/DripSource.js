// util/DripSource.js - couples all-at-once input into the node stream paradigm
'use strict';

var util   = require('util');
var Stream = require('stream');

module.exports = DripSource;

function DripSource(chunk, data) {
    Stream.call(this);

    if (! (data instanceof Buffer)) throw "data must be a Buffer";
    if (! (('number' == typeof chunk) && chunk > 0) ) throw "chunk must be a number >0";

    this.readable = true;
    this.writable = false;
    this._paused  = false;

    this._chunk  = chunk;
    this._data   = data;
    this._offset = 0;
}
util.inherits( DripSource, Stream );

DripSource.prototype.pause = function() {
    this._paused = true;
};
DripSource.prototype.resume = function() {
    if (this._paused) {
        this._paused = false;
        this.start();
    }
};

DripSource.prototype.start = function() {
    while (! this._paused && this._data) {
        var qty = Math.min( this._chunk, this._data.length - this._offset );

        if (qty > 0) {
            this.emit('data', this._data.slice( this._offset, this._offset + qty ));
            this._offset += qty;
            if (this._offset == this._data.length) {
                this.emit('end');
                this._data = null;
            }
        }
    }
};

DripSource.prototype.pipe = function() {
    var r = Stream.prototype.pipe.apply(this, arguments);
    this.start();
    return r;
};

/*

=head1 NAME

util/DripSource.js - couples input into the node stream paradigm

=head1 SYNOPSIS

new DripSource(2048, myBuf).pipe(outStream)

*/
