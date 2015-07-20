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

  fmt.Println("conn: %s", conn)

}