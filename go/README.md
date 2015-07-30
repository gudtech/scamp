SCAMP Go Lang Edition
=====================

The `scamp` package provides all the facilities necessary for participating in a SCAMP environment:

  * Parsing the discovery cache and building a directory of available services
  * Parsing packets streams
  * Parsing and verifying messages

Architecture
--------

Remote services are invoked by first establishing a `Connection` (TLS under the hood). This `Connection` can then be used to spawn `Sessions` which send a `Request` and block until a `Reply` is provided.

Usage
-----

	func main() {
		scamp.Initialize()

		conn := new(scamp.Connection)
		err := conn.Connect("127.0.0.1:30100")
		defer conn.Close()

		if err != nil {
			scamp.Error.Printf("could not connect! `%s`\n", err)
			return
		}

		request := scamp.Request{
			Action:         "helloworld.hello",
			envelopeFormat: scamp.ENVELOPE_JSON,
			Version:        1,
		}
		conn.SendRequest(request)
		reply, err := conn.RecvReply()
		if err != nil {
			scamp.Error.Printf("error receving reply: `%s`", err)
		}
		scamp.Info.Printf("got reply: `%s`", reply)
	}

Running the test suite
----------------------

  export GOPATH=$PWD
  go test scamp

Documentation
-------------

	export GOPATH=$PWD
	godoc -http=:6060
	# open http://localhost:6060/