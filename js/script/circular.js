'use strict';

// Pinboard server process: listens on port 51358/SCAMPv1 and allows SOA services to announce their presence
// Anyone can connect to the pinboard and must immediately send a type:"hello" packet with an appropriate secret key (the pinboard itself is TLS-protected)
// Processes which wish to send announcements shall send type:"announce" packets.  after this, the service is considered announced indefinitely
// connections are protected by a 60 second heartbeat
// processes can send type:"rescind" packets at any time
// the server only accepts packets with an authorized key, and tracks a status for each *connection*/identifier pair; one of {void,active,linger}
// when a connection is lost without rescind, the states all go to linger for 20 seconds
// from the perspective of an observer, the connection-ness is collapsed and there is simply a status per identifier: active beats linger beats void
// thus a service has 20 seconds to reconnect and reannounce to avoid any false notification to observers
// for extra redundancy, we will run 2+ pinboards, the observer will connect to some of them and union the inputs
// services must announce to all
// future: cross-connect pinboards so that they auto-synchronize and services can announce to 'some'

var tls          = require('tls'),
    soa          = require('../lib/index.js'),
    conn         = soa.module('transport/scamp/connection.js'),
    Message      = soa.module('handle/Message'),
    events       = require('events'),
    crypto       = require('crypto'),
    fs           = require('fs');

//////////////////

function StateManager(params) {
    events.EventEmitter.call(this);
    this._serverId = crypto.randomBytes(18).toString('base64');
    this._nextId = 0;
    this._map = {}; // map from blobs to lists of who's claiming this
    this._active = {}; // truthy blobs
    this.secret = params.secret;
    this.peerStrings = params.peerStrings;
    this.setMaxListeners(1000);
    this.gracePeriod = 20000; // 20 seconds to reconnect and reannounce after an ungraceful disconnect
    this.heartbeatPeriod = 10000; // send heartbeats every 10 seconds.  this is also the response window
}
require('util').inherits(StateManager, events.EventEmitter);

// Note1: it is the caller's responsibility to call this again when staleness happens
// Note2: this will provide input into the p2p system, eventually
// Timestamp is an increasing identifier to recognize most-recent-ness; it's the local time on the initiating node
// states are boolean.  we track active/not active for each blob/connection pair.  we also track timestamps to reject stale updates in a p2p situation
// if a pair has been inactive for > 1 day, we forget it

StateManager.prototype.register = function (connectionId, blob, state, timestamp) {
    // TODO: support for actually deleting entries to free memory?

    var blobInfo = this._map[blob];

    if (!blobInfo) {
        blobInfo = this._map[blob] = {};
    }

    // set for this connection if timestamp coherent
    if (!blobInfo[connectionId] || blobInfo[connectionId].time < timestamp) {
        blobInfo[connectionId] = { time: timestamp, active: state };
    }

    // update this._active
    var active = 0;
    Object.keys(blobInfo).forEach(function (cid) {
        if (blobInfo[cid].active) active=1;
    });

    var was_active = this._active[blob];

    // fire changed
    if (active && !was_active) {
        this._active[blob] = 1;
        this.emit('changed', blob, 1);
    }
    else if (was_active && !active) {
        delete this._active[blob];
        this.emit('changed', blob, 0);
    }
};

StateManager.prototype.getActive = function () {
    return Object.keys(this._active);
};

StateManager.prototype.newConnectionId = function () {
    return this._serverId + '.' + ++this._nextId;
};

////////////////////////

function InConnection(clear, statemgr) {
    // proxy connections receive messages
    // maintain this._dead, this._authed
    // first event must contain an auth string.  (probably all of them)
    // 'announce', 'rescind', 'assert'
    // 'observe' -> we listen for state changes on the backend and start spewing 'em
    // heartbeat every 30s
    // peering open
    var me = this;

    soa.debug('New inbound connection');

    me._statemgr = statemgr;
    me._id = statemgr.newConnectionId();
    me._proto = conn.wrap(clear);
    me._dead = false;
    me._blobsActive = {};
    me._consuming = false;

    me._proto.on('message', me.onMessage.bind(me));
    me._proto.on('lost', me.onList.bind(me));

    me._heartbeatTimer = setInterval(function() {
        if (me._heartbeat) {
            // force drop the connection
            me._proto._onerror(false, 'Heartbeat got no reply');
        } else {
            me._heartbeat = true;
            me.sendReply({ type: 'heartbeat' });
        }
    }, me._statemgr.heartbeatPeriod);

    me._proto.start();
}

InConnection.prototype.sendReply = function (h) {
    if (this._dead) return;
    console.log('packet out',this._id,h);
    var rpy = new Message(h);
    this._proto.sendMessage(h);
    rpy.slurp(new Buffer(0));
};

InConnection.prototype.verifyBlob = function (blob) {
    // TODO.  not massively important since we have the secret-based auth system, and all consumers will reverify
    return true;
};

InConnection.prototype.onLost = function () {
    var me = this;

    if (me._dead) return;

    var drop = Object.keys(me._blobsActive);
    me._blobsActive = null;

    setTimeout( function () {
        drop.forEach(function (blob) {
            me._statemgr.register(me._id, blob, 0, Date.now());
        });
    }, me._statemgr.gracePeriod);

    if (me._consuming) {
        me._statemgr.removeListener('changed', me._consumingListener);
        me._consuming = me._consumingListener = false;
    }

    if (me._heartbeatTimer) {
        clearInterval(me._heartbeatTimer);
        me._heartbeatTimer = 0;
    }
};

InConnection.prototype.onMessage = function (req) {
    var me = this;

    if (me._dead) return;
    if (req.header.secret != this._statemgr.secret) {
        this._proto._onerror(false, 'Improperly authenticated inbound message');
        return;
    }
    console.log('packet in',me._id,req.header);

    switch (req.header.type) {
        case 'heartbeat':
            me._heartbeat = false;
            break;

        case 'getpeers':
            me.sendReply({ type: 'peers', peers: me._statemgr.peerStrings });
            break;

        case 'announce':
            // set or replace or delete an announcement for <ident>=<blob>.  link it to this connection so it can be nulled out 20 seconds after connection drop
            if (!me.verifyBlob(blob)) return;
            me._statemgr.register(me._id, blob, req.header.active, Date.now());
            if (req.header.active) {
                me._blobsActive[blob] = 1;
            } else {
                delete me._blobsActive[blob];
            }
            break;

        case 'assert':
            // announce <blob> for <connectionId>, *not* this connection, used for p2p
            // TODO: need a way to remove all announcements for a pool of connectionIds if a peer vanishes
            break;

        case 'observe':
            // send all known announcements as events of type 'change', catchup: true
            me._statemgr.getActive().forEach(function (blob) {
                me.sendReply({ type: 'change', blob: blob, active: true, catchup: true });
            });
            // then send a 'done', and additional events as they come in
            me.sendReply({ type: 'catchup_done' });
            if (!me._consuming) {
                me._consuming = true;
                me._consumingListener = function (blob, active) {
                    me.sendReply({ type: 'change', blob: blob, active: !!active, catchup: false });
                };
                me._statemgr.addListener('changed', me._consumingListener);
            }
            break;
    }
};

// TODO: implement cross-strapping/p2p.  this entails:
// 1. a server can open a connection to another server, announce its identity and send/receive 'assert' packets
// 2. servers track link-up/link-down as a separate class of messages
// 3. announcements are only regarded if we can draw a continuous chain of link-ups from us to the originating server

////////////////////////

function ConnectionServer(params) {
    var me = this;

    me._tlssrv = tls.createServer({
        key:  params.key,
        cert: params.cert,
        honorCipherOrder: true,
    }, function (cleartextStream) {

        new InConnection(cleartextStream, params.stateMgr);
    });

    me._tlssrv.on('error', function (e) {
        soa.fatal(e);
    });

    me._tlssrv.listen( params.port, params.address, function () {
        soa.info("Listening for connections on", params.port, params.address);
    } );
}

/////////////////////////

(function () {
    var argp = require('argparser').vals('pidfile').parse();

    if (argp.opt('pidfile'))
        fs.writeFileSync(argp.opt('pidfile'), process.pid);

    var cfg = soa.config();
    var stateMgr = new StateManager({
        secret: cfg.val('circular.secret'),
        peerStrings: cfg.val('circular.peers','').split(/\s*,\s*/).filter(function(s){return !!s;}),
    });

    var server = new ConnectionServer({
        stateMgr: stateMgr,
        key: require('fs').readFileSync(cfg.val('circular.key_file')),
        cert: require('fs').readFileSync(cfg.val('circular.cert_file')),
        port: cfg.val('circular.port',51358),
        address: cfg.val('circular.address'),
    });
})();
