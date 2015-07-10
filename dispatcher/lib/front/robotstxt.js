function RobotsTxt() {}
module.exports = RobotsTxt;

RobotsTxt.prototype.request = function(path, http_req, http_res) {
    if (path != "robots.txt") return false;

    http_res.writeHead(200, {'Content-Type': 'text/plain'});
    http_res.end( '# There is no static content on this host.  Nothing to see here, move along.\r\nUser-agent: *\r\nDisallow: /\r\n', 'utf8' );
};
