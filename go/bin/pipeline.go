package main

import "scamp"

func main() {
	scamp.Initialize()

	conn, err := scamp.Connect("127.0.0.1:30101")
	defer conn.Close()

	if err != nil {
		scamp.Error.Fatalf("could not connect! `%s`\n", err)
	}

	var sess *scamp.Session

	inflight := make(chan bool, 500)

	for {
		inflight <- true
		
		go func(){
			sess, err = conn.Send(scamp.Request{
				Action:         "helloworld.hello",
				EnvelopeFormat: scamp.ENVELOPE_JSON,
				Version:        1,
			})
			if err != nil {
				scamp.Error.Fatalf("error initiating session: `%s`", err)
			}

			reply, err := sess.RecvReply()
			if err != nil {
				scamp.Error.Fatalf("error receiving: `%s`", err)
			}
			scamp.Info.Printf("Got reply! `%s`", reply.Blob)

			<-inflight
		}()
	}
}