package main

import "scamp"

func main() {
	scamp.Initialize()

	service := scamp.NewService()
	service.Register("hello.helloword", func(sess *scamp.Session){
		scamp.Error.Fatalf("yay %s", sess)
	})
	err := service.Listen(30100)
	if err != nil {
		scamp.Error.Fatalf("error starting listener: `%s`", err)
	}

	wait := make(chan bool)
	go service.AcceptRequests()
	_ = <-wait
}