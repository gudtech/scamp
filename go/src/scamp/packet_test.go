package scamp

import "testing"
import "bytes"
import "fmt"

func TestReadPacketOK(t *testing.T){
  byteBuf := []byte("HEADER 1 46\r\n{\"action\":\"foo\",\"version\":1,\"envelope\":\"json\"}END\r\n")
  byteReader := bytes.NewReader(byteBuf)

  packet,err := ReadPacket( byteReader )
  if err != nil {
    t.Errorf("got err `%s`", err)
    t.FailNow()
  }
  if packet.packetType != HEADER {
    t.Errorf("packetType was not parsed correctly. packet.packetType: `%d`", packet.packetType)
    t.FailNow()
  }
  if !bytes.Equal(packet.body, []byte(`{"action":"foo","version":1,"envelope":"json"}`)) {
    t.Errorf("body was not parsed correctly. packet.body: `%s`", packet.body)
    t.FailNow()
  }

  header := packet.packetHeader
  emptyHeader := PacketHeader{}
  if header == emptyHeader {
    t.Errorf("header was not parsed")
    t.FailNow()
  }
  if header.version != 1 {
    t.Errorf("expected header.version to be 1 but got %d", header.version)
    t.FailNow()
  }
  if header.action != "foo" {
    t.Errorf("expected header.action to be `foo` but got `%s`", header.action)
    t.FailNow()
  }
  if header.envelope != ENVELOPE_JSON {
    t.Errorf("expected header.envelope to be ENVELOPE_JSON (%d) but got %d", ENVELOPE_JSON, header.envelope)
    t.FailNow()
  }
}

func TestFailGarbage(t *testing.T){
  byteBuf := []byte("asdfasdf")
  byteReader := bytes.NewReader(byteBuf)

  _,err := ReadPacket( byteReader )
  if err == nil {
    t.Errorf("expected non-nil err", err)
    t.FailNow()
  }
  if(fmt.Sprintf("%s", err) != "header must have 3 parts") {
    t.Errorf("expected `%s`, got `%s`", "header must have 3 parts", err)
    t.FailNow()
  }
}

func TestFailHeaderParams(t *testing.T){
  byteReader := bytes.NewReader( []byte("HEADER 1\r\n{\"action\":\"foo\",\"version\":1,\"envelope\":\"json\"}END\r\n") )

  _,err := ReadPacket( byteReader )
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

//   _,err := ReadPacket( byteReader )
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

  _,err := ReadPacket( byteReader )
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

  _,err := ReadPacket( byteReader )
  if(fmt.Sprintf("%s", err) != "packet was missing trailing bytes") {
    t.Errorf("expected `%s`, got `%s`", "packet was missing trailing bytes", err)
    t.FailNow()
  }
}