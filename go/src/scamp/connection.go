package scamp

import "fmt"

// import "net"
import "crypto/tls"

type Connection struct {
}

func (conn *Connection)Connect() (err error) {
  config := &tls.Config{
    InsecureSkipVerify: true,
  }
  config.BuildNameToCertificate()

  listener, err := tls.Dial("tcp", "192.168.11.148:30330", config)
  if err != nil {
    return
  }

  fmt.Printf("sup listener %s", listener)

  return
}