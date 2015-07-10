var dgram = require('dgram'),
    zlib  = require('zlib'),
    soa  = require('../..');

var info = soa.config().busInfo();
var socket = dgram.createSocket('udp4');
socket.bind( info.port, info.group );
info.discovery.forEach(function (a) { socket.addMembership( info.group, a ); });

socket.on('message', function(blob) {
    zlib.inflate(blob, function (err, ublob) {
        if (err) {
            console.log('%%%', '[Decompress error]', err);
            console.log(blob.toString());
        } else {
            console.log('%%%', '[Compressed]', blob.length, ublob.length);
            console.log(ublob.toString());
        }
    });
});

setInterval( function () { }, 1000 ); // stop exit
