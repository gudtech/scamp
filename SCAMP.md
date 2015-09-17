SCAMP
=====

The Service Oriented Architecture (SOA) Overview
------------------------------------------------

The SCAMP service oriented architecture (SOA) is a shared bus which connects users of modules to their implementation. This architecture has a number of benefits, including:

 * **Cross Platform** Services can be written in any language. The communication protocol can be implemented in any language and run on any machine in the network.

 * **Built-in Discovery** Services are discovered through UDP multicast and registry caches. This enables instant and configuration-free operation

 * **Pervasive** Designed for use on all infrastructure components. Suitable for carrying data such as HTTP, background jobs, logging and more.

 * **Automatic Failover and Load Balancing** The decoupled nature of services and requesters allows for services to scale independently. In the case of a failing service, requests are automatically routed to healthy instances.

 * **Security** All communication is encrypted with industry standard TLS. All services must be cryptographically authorized. All requests require a valid capability token.

 * **Unified Configuration** All SCAMP implementations leverage the same configuration which greatly simplifies service provisioning.

 * **Low Latency** In general, services and their requesters maintain persistent connections

Service Discovery
=================

Discovery can be done two ways: low-level UDP multicast announcement on a regular interval and service cache querying.

A persistent listener tracks all annoucement packets and maintains a local cache. The cache is used by nearby requesters to find the best available service. The service cache is especially useful for short-lived requesters which may not have time to gather all announcements.

Cache
------

```
CACHE = CACHE_ENTRY*
CACHE_ENTRY = LF SERVICE_SPEC LF LF CERT LF LF SIG

SERVICE_SPEC = [ VERSION, SERVICE_IDENTIFIER, REGION, DEFAULT_WEIGHT, INTERVAL, CONN_SPEC, SUPP_PROT, CLASS_RECORD, TIMESTAMP ]
VERSION = DIGIT
SERVICE_IDENTIFIER = '"' ALPHANUM '"'
REGION = "main"
DEFAULT_WEIGHT = DIGIT+
INTERVAL = DIGIT+
CONN_SPEC = URL
SUPP_PROT = []PROT
PROT = "json" | "extdirect" | "jsonstore"
CLASS_RECORD = // not yet defined
TIMESTAMP = UNIX_TIMESTAMP_W_MS

CERT = PKCS_1_FORMAT_CERT
SIG = PKCS_1_SHA256
```

UDP multicast annoucement
-------------------------

TODO: runs on well known port? well known format? what interval?

Point to Point Communication
============================

Communication is done through *request*/*reply* messaging operations. A *message* is transmitted in *packets*.

Request
-------

```
HEADER DATA* [ EOF | TXERR ]
```

Reply
-----

```
HEADER DATA* [ EOF | TXERR ]
```

General Packet Encoding
-----------------------

```
PACKET = TYPE SPACE MSGNO SPACE BODYLEN CRLF BODY END CRLF

TYPE = "HEADER" | "DATA" | "EOF" | "TXERR" | "ACK"
MSGNO = DIGIT+
BODYLEN = DIGIT+
BODY = DIGIT+ // == BODYLEN*OCTET
SPACE = ' '
CRLF = "\r\n"
```

HEADER Packet
-------------

```
PACKET as above but with these restrictions:

TYPE = "HEADER"
BODY = HEADER_JSON

HEADER_JSON["type"] = "request"
HEADER_JSON["action"] = ACTION
HEADER_JSON["envelope"] = ENVELOPE_FORMAT
HEADER_JSON["request_id"] = DIGIT+

HEADER_JSON["station"] = TICKET
HEADER_JSON["ticket"] = TICKET
HEADER_JSON["version"] = NUMBER
```

EOF Packet
----------

```
PACKET as above but with these restrictions:

TYPE = "EOF"
BODY = ""
```
