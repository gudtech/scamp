package main

import "fmt"
import "scamp"

func main() {
  conn := new(scamp.Connection)
  err := conn.Connect()

  if err != nil {
    fmt.Printf("could not connect! `%s`\n", err)
    return
  }

  request := scamp.Request{
    Action: "helloworld",
    EnvelopeFormat: scamp.ENVELOPE_JSON,
    Version: 1,
  }
  packets := request.ToPackets()
  fmt.Printf("packets len: %d\n", len(packets) )

  conn.SendRequest(request)
}