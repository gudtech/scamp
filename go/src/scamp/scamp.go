// Copyright 2014 GüdTech, Inc.

/*
SCAMP provides SOA bus RPC functionality. Please see root SCAMP/README.md for details on configuring environment.

Basics

Services and requesters communicate over persistent TLS connections. First, initialize your environment according to the root README.md. You must have a valid certificate and key to present a service.

Listening For Requests

  service,err := scamp.NewService(30100)
  if err != nil {
	fmt.Printf("could not create service")
	return
  }
  service.Register("helloworld.hello", func(sess *scamp.Session){
  })
  service.AcceptSessions()

Making a Request against a Service

*/
package scamp

// Package-level setup. Right now it just sets up logging.
func Initialize() {
	initSCAMPLogger()
}