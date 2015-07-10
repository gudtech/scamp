# NAME

SCAMP config file syntax and known options

# DESCRIPTION

SCAMP SOA uses the config file **/etc/SCAMP/soa.conf** file, or an
alternate file specified by the **SCAMP** environment variable.  The file is
formatted as key-value pairs, one per line, with optional blank lines and
comments introduced by `#`.  Keys and values are separated by `=`.

# OPTIONS

## scamp.first\_port

Default 30100

## scamp.last\_port

Default 30399

## scamp.bind\_tries

Default 20

## scamp.client\_timeout

Default 90 seconds

## scamp.server\_timeout

Default 120 seconds

## bus.address

Defines the network interfaces to use for service discovery and communication.
May be set to a comma-separated list of interface specifiers, each of which
is either an IPv4 address or a string of the form `if:eth1` specifying an
interface by name.  If no specifiers are provided, an interface with an
organization-local address will be automatically and arbitrarily picked.
All addresses will be used to send and receive multicast announcements.  The
service's TCP listener will be bound to the first given address.  May be
selectively overridden using `discovery.address` and `service.address`.

## bus.authorized\_services

Points to a file containing service key fingerprints and allowed actions.

## cache.ping\_interval

CONJECTURAL

## discovery.address

If set, overrides `bus.address` for multicast announcements.  Same syntax.

## discovery.multicast\_address, discovery.port

Multicast address and port to use for EPGM service discovery.  Defaults to
"239.63.248.106", 5555.

## discovery.cache\_max\_age

Maximum age for cache to not be considered in error, default 120 (seconds).

## discovery.cache\_path

File path for storing discoveries for short-lived services.

## discovery.crosspost

Comma-separated list of IP addresses identifying additional interfaces to send announcements to.

## dispatcher.port

## dispatcher.ssl\_cert\_file

## dispatcher.ssl\_key\_file

## flow.max\_inflight

Default 65536 bytes; (loose) maximum unacknowledged data allowed to exist on
the service bus for a single message stream.

## rpc.timeout

Default 75 seconds

## service.address

If set, overrides `bus.address` for TCP listening.  Same syntax.

## worker.kill\_delay

Time between sending SIGTERM and sending SIGKILL when shutting down a worker,
defaults to 2, units seconds.

## worker.limit

Hard cap on number of worker processes.  Default 256.

## worker.max\_spares

If more than this many workers are IDLE, they are killed at one per second.
Default 10.

## worker.min\_spares

If fewer than this many workers are IDLE, they are spawned at one per second.
Default 5.

## worker.start

Number of worker processes to start initially.  Default 5.

## worker.timeout

Time which a worker is permitted to spend between receiving a header and
finishing a reply.  Default 60 (seconds).

## zmq.first\_port

Default 30100

## zmq.last\_port

Default 30399

## zmq.bind\_tries

Default 20

## zmq.pushsocket\_ttl

Default 30 (units: seconds)

## <name>.soa\_key

Points to a PEM-encoded PKCS#8-wrapped RSA private key in PKCS#1 RSAPrivateKey format.

## <name>.soa\_cert

Points to a PEM-encoded X.509 Certificate.

## <name>.logfile

Path of a file to send log messages to.
