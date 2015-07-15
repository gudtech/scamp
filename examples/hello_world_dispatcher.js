'use strict';

var scamp = require(process.cwd() + "/../scamp"),
    requester = scamp.requester({ cached: true, ident: 'hello_world_dispatcher' });

var cmd = { action: 'helloworld.hello', version: 1, envelope: 'json' };
requester.makeJsonRequest(cmd, {}, function (err_code, err, ret) {
  scamp.info("nice");
});
