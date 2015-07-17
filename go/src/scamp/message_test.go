package scamp

import "testing"
import "bytes"

func TestInstantiateFromStream(t *testing.T){
  byteBuf := []byte("1111111111222222222233333333334444444444\n")
  byteReader := bytes.NewReader(byteBuf)

  message,err := NewMessage( byteReader )
  if err != nil {
    t.Errorf("got err %s", err)
    t.Fail()
  }
  if !bytes.Equal(message.header, byteBuf[0:40]) {
    t.Errorf("headers were not equal")
    t.Fail()
  }
}