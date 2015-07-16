package scamp

import "fmt"
import "testing"
import "bytes"

func TestInstantiateMessage(t *testing.T){
  header := make([]byte, 5, 5)
  message := Message{header: header}
  fmt.Printf("hey! %s", message)
}

func TestInstantiateFromStream(t *testing.T){
  byteBuf := []byte("1111111111222222222233333333334444444444")
  byteReader := bytes.NewReader(byteBuf)

  fmt.Printf("fauxStream: %s", byteReader)
}