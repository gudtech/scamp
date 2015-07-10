// The general idea here is that when we get a signal, we should stop taking new requests, wait up to five minutes for
// current requests to finish, then exit.  This mostly requires cooperation from the frontend bits.

// API:
// shutdown = new Shutdown()
// shutdown.on('start', /* stop taking requests */)
// shutdown.started /* should we take requests? */
// shutdown.start() /* if you want to do it programmatically
// hold = shutdown.hold('Reason') /* we have a current request */
// hold.release() /* it's done */
'use strict';
var EventEmitter = require('events').EventEmitter;

function Shutdown() {
    EventEmitter.call(this);
    this.holds = {};
    this.nholds = 0;
    this.exit_code = 0;

    var me=this;
    process.on('SIGTERM', function () { me.exit_code = 51; me.start(); }); // magic code to tell our wrapper not to restart

    process.on('SIGINT', function () { me.start() });
    process.on('SIGQUIT', function () { me.start() });
    process.on('SIGHUP', function () { me.start() });
}
require('util').inherits(Shutdown, EventEmitter);

Shutdown.prototype.hold = function (why) {
    var h = new Hold(this, why);
    this.holds[h.id] = h;
    this.nholds++;
    //console.log('Hold',why,'granted at',new Date());
    return h;
};

Shutdown.prototype.dumpHolds = function () {
    Object.keys(this.holds).forEach(function (id) {
        var hh = this.holds[id];
        console.log('Reason:',hh.reason,'Age:',(Date.now()-hh.issued)/1000,'seconds');
    }, this);
};

Shutdown.prototype.maybeExit = function () {
    if (this.started && !this.nholds) {
        console.log('Shutdown complete after',(Date.now()-this.started)/1000,'seconds');
        process.exit( this.exit_code );
    }
};

Shutdown.prototype.start = function () {
    if (this.started) {
        console.log('Repeat shutdown request');
        return;
    }
    console.log('Shutdown request at',new Date());
    this.started = Date.now();
    this.emit('start');
    var me=this;

    me.dumpHolds();

    setTimeout( function () {
        console.log('Forced shutdown after 5 min: remaining holds are:');
        me.dumpHolds();
        me.nholds = 0;
        me.maybeExit();
    }, 300 * 1000 );

    this.maybeExit();
};

var next_hold = 0;
function Hold(against, why) {
    this.holdee = against;
    this.reason = why;
    this.issued = Date.now();
    this.id     = ++next_hold;
}

Hold.prototype.release = function() {
    if (this.holdee.holds[ this.id ]) {
        delete this.holdee.holds[ this.id ];
        this.holdee.nholds--;
        //console.log('Hold',this.reason, 'released after', (Date.now() - this.issued)/1000, 'seconds');
        this.holdee.maybeExit();
        return true;
    }
};

module.exports = Shutdown;
