SCAMP Go Lang Edition
=====================

The `scamp` package provides all the facilities necessary for participating in a SCAMP environment:

  * Parsing the discovery cache and building a directory of available services
  * Parsing packets streams
  * Parsing and verifying messages

Running the test suite
----------------------

  export GOPATH=$PWD
  go test scamp

Design
------

SCAMP is a layered communication protocol. The high-level units are `Request`/`Reply`.

A `Request` is transmitted as a `HeaderPacket` followed by one or more `DataPacket`s and finally a `EofPacket`. A `Request` will not be considerd by the receiving end until the `EofPacket` is received.

The `Packet` interface delegates encoding/decoding to the individual `HeaderPacket`/`DataPacket`/`EofPacket`. a `Request` to be renderd as a `[]Packet` and each `Packet` can be sent on the wire.