'use strict';

var scamp = require(process.cwd() + "/../scamp/"),
    svc = scamp.service({ tag: 'helloworld' });

svc.registerAction('helloworld.hello', 'noauth', svc.staticJsonHandler(function(ticket, data, return_handler) {

    // do some stuff
    // and then respond

    return_handler({ hello_world_text: 'Hello Javascript World!' });

}));

