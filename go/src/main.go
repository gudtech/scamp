package main

import "fmt"
import "scamp"

func main() {
  conn := new(scamp.Connection)
  err := conn.Connect("127.0.0.1:30100")
  defer conn.Close()

  if err != nil {
    fmt.Printf("could not connect! `%s`\n", err)
    return
  }

  request := scamp.Request{
    Action: "helloworld.hello",
    EnvelopeFormat: scamp.ENVELOPE_JSON,
    Version: 1,
  }
  conn.SendRequest(request)
  conn.RecvReply()
  // conn.RecvReply()

  // request = scamp.Request{
  //   Action: "helloworld.hello",
  //   EnvelopeFormat: scamp.ENVELOPE_JSON,
  //   Version: 1,
  // }
  // conn.SendRequest(request)
  // conn.RecvReply()

}