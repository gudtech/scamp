'use strict';
var soa = require('../lib');

var svc = soa.service({
    tag: 'jstest',
});

svc.registerAction( 'Auth.jstest', svc.cookedHandler(function (header, data) {
    return {content: "Hello world"};
}));
