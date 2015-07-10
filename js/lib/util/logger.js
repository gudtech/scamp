
// Rules (XXX maybe make them configurable?):
//  * Errors and fatals always go to STDERR.
//  * Error, fatal, and info go to the log file.
//  * In debug mode, everything goes to STDERR.
//  * Messages generated when no log file are buffered so they may be logged later.

var fs   = require('fs'),
    soa  = require('../index.js'),
    util = require('util');

var config = {
    debug: true,
    tag:   'unconfigured',
};

var log_file;
var log_buffer = [];

exports.log = function (severity, msgbits) {
    if (severity == 'debug' && !config.debug) return; // short circuit
    var message = util.format.apply(util, msgbits);

    var line = [
        new Date().toISOString(),
        config.tag,
        process.pid,
        severity,
        message
    ].join('\t') + '\n';

    if (severity == 'error' || severity == 'fatal' || config.debug) {
        process.stderr.write(line);
    }

    if (severity != 'debug') {
        if (log_file) {
            log_file.write(line);
        } else {
            log_buffer.push(line);
        }
    }

    if (severity == 'fatal') process.exit(1);
};

exports.configure = function (params) {
    if (config.configured) throw 'Log can only be configured once';

    if ('object' != typeof params) throw 'params must be object';
    if (!params.tag) throw 'params.tag must be specified';

    config.tag = params.tag;
    config.configured = true;
    config.debug = params.debug;

    log_file = fs.createWriteStream(soa.config().val(params.tag + '.logfile', '/var/log/scamp/'+params.defname+'.log'), { flags: 'a' });

    log_buffer.forEach(log_file.write.bind(log_file));

    exports.log('info', ['Log started']);

    process.on('exit', function () { exports.log('info', ['Log ended']); });
};
