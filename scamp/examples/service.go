package main

import "scamp"

var famous_words = []byte("SCAMP SAYS HELLO WORLD")

func main() {
	scamp.Initialize()

	service,err := scamp.NewService(30100)
	if err != nil {
		scamp.Error.Fatalf("error creating new service: `%s`", err)
	}
	service.Register("helloworld.hello", func(req scamp.Request, sess *scamp.Session){
		err = sess.SendReply(scamp.Reply{
			Blob: famous_words,
		})
		if err != nil {
			scamp.Error.Printf("error while sending reply: `%s`. continuing.", err)
			return
		}
		scamp.Trace.Printf("successfully responded to hello world")
	})

	service.Run()
}