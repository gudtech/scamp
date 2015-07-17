package scamp

import "testing"
import "bytes"
import "fmt"

func TestBuildPacketOK(t *testing.T){
  byteBuf := []byte("HEADER 1 46\r\n{\"action\":\"foo\",\"version\":1,\"envelope\":\"json\"}END\r\n")
  byteReader := bytes.NewReader(byteBuf)

  packet,err := BuildPacket( byteReader )
  if err != nil {
    t.Errorf("got err `%s`", err)
    t.FailNow()
  }
  if !bytes.Equal(packet.packetType, []byte("HEADER")) {
    t.Errorf("packetType was not parsed correctly. packet.packetType: `%s`", packet.packetType)
    t.FailNow()
  }
  if !bytes.Equal(packet.body, []byte(`{"action":"foo","version":1,"envelope":"json"}`)) {
    t.Errorf("body was not parsed correctly. packet.body: `%s`", packet.body)
    t.FailNow()
  }
}

func TestFailGarbage(t *testing.T){
  byteBuf := []byte("asdfasdf")
  byteReader := bytes.NewReader(byteBuf)

  _,err := BuildPacket( byteReader )
  // TODO how can I actually compare errors to make sure
  // it's the right one?
  if err == nil {
    t.Errorf("expected non-nil err", err)
    t.FailNow()
  }
}

func TestFailHeaderParams(t *testing.T){
  byteReader := bytes.NewReader( []byte("HEADER 1\r\n{\"action\":\"foo\",\"version\":1,\"envelope\":\"json\"}END\r\n") )

  _,err := BuildPacket( byteReader )
  if err == nil {
    t.Errorf("expected non-nil err", err)
    t.FailNow()
  }
  if(fmt.Sprintf("%s", err) != "header must have 3 parts") {
    t.Errorf("expected `%s`, got `%s`", "header must have 3 parts", err)
    t.FailNow()
  }
}

// TODO: string cmp not working well
// func TestFailHeaderBadType(t *testing.T){
//   byteReader := bytes.NewReader( []byte("HEADER a b\r\n{\"action\":\"foo\",\"version\":1,\"envelope\":\"json\"}END\r\n") )

//   _,err := BuildPacket( byteReader )
//   if err == nil {
//     t.Errorf("expected non-nil err", err)
//     t.FailNow()
//   }
//   if(fmt.Sprintf("%s", err) != "header must have 3 parts") {
//     t.Errorf("expected `%s`, got `%s`", "strconv.ParseInt: parsing \"a\": invalid syntax", err)
//     t.FailNow()
//   }
// }

func TestFailTooFewBodyBytes(t *testing.T){
  byteReader := bytes.NewReader( []byte("HEADER 1 46\r\n{\"\":\"foo\",\"version\":1,\"\":\"json\"}END\r\n") )

  _,err := BuildPacket( byteReader )
  if err == nil {
    t.Errorf("expected non-nil err", err)
    t.FailNow()
  }
  if(fmt.Sprintf("%s", err) != "EOF") {
    t.Errorf("expected `%s`, got `%s`", "EOF", err)
    t.FailNow()
  }
}

func TestFailTooManyBodyBytes(t *testing.T){
  byteReader := bytes.NewReader( []byte("HEADER 1 46\r\n{\"\":\"foo\",\"version\":1,\"\":\"jsonasdfasdfasdfasdf\"}END\r\n") )

  _,err := BuildPacket( byteReader )
  if(fmt.Sprintf("%s", err) != "packet was missing trailing bytes") {
    t.Errorf("expected `%s`, got `%s`", "packet was missing trailing bytes", err)
    t.FailNow()
  }
}