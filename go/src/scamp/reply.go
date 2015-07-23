package scamp

import "io"
import "fmt"

type Reply struct {
  blob []byte
}

func (rep *Reply)Read(reader io.Reader) {
  buf := make([]byte, 200)

  fmt.Printf("reading...\n")
  bytes_read,err := reader.Read(buf)
  if err != nil {
    fmt.Printf("error reading `%s`\n", err)
  } else {
    fmt.Printf("read %d bytes. %s\n", bytes_read, buf)
  }
  fmt.Printf("done reading\n")

  // for {
  //   bytes_read,err := reader.Read(rep.blob)
  //   if err != nil {
  //     fmt.Printf("error! %s", err)
  //   } else {
  //     if bytes_read > 0 {
  //       fmt.Printf("whoaaa. read %d", len(rep.blob))
  //     }
  //   }
  // }
}