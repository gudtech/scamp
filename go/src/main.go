package main

import "scamp"

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
		EnvelopeFormat: scamp.ENVELOPE_JSON,
		Version:        1,
	}
	conn.SendRequest(request)
	reply, err := conn.RecvReply()
	if err != nil {
		scamp.Error.Printf("error receving reply: `%s`", err)
	}
	scamp.Info.Printf("got reply: `%s`", reply)
}
