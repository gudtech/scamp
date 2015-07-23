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
  if header.Version != 1 {
    t.Errorf("expected header.version to be 1 but got %d", header.Version)
    t.FailNow()
  }
  if header.Action != "foo" {
    t.Errorf("expected header.action to be `foo` but got `%s`", header.Action)
    t.FailNow()
  }
  if header.Envelope != ENVELOPE_JSON {
    t.Errorf("expected header.envelope to be ENVELOPE_JSON (%d) but got %d", ENVELOPE_JSON, header.Envelope)
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
  if(fmt.Sprintf("%s", err) != "EOF") {
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
  if(fmt.Sprintf("%s", err) != "expected integer") {
    t.Errorf("expected `%s`, got `%s`", "expected integer", err)
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

func TestWriteHeaderPacket(t *testing.T){
  packet := Packet{
    packetType: HEADER,
    packetMsgNo: 0,
    packetHeader: PacketHeader {
      Action: "hello.helloworld",
      Envelope: ENVELOPE_JSON,
      MessageId: "0123456789012345",
      Version: 1,
    },
    body: []byte(""),
  }
  expected := []byte("HEADER 0 109\r\n{\"action\":\"hello.helloworld\",\"envelope\":\"JSON\",\"message_id\":\"0123456789012345\",\"type\":\"REQUEST\",\"version\":1}\nEND\r\n")

  buf := new(bytes.Buffer)
  err := packet.Write(buf)
  if err != nil {
    t.Errorf("unexpected error while writing to buf `%s`", err)
    t.FailNow()
  }

  if !bytes.Equal(expected, buf.Bytes()) {
    t.Errorf("expected\n`%s`\n`%v`\ngot\n`%s`\n`%v`\n", expected, expected, buf.Bytes(), buf.Bytes())
    t.FailNow()
  }
}

func TestWriteEofPacket(t *testing.T) {
  packet := Packet{
    packetType: EOF,
    packetMsgNo: 0,
    body: []byte(""),
  }
  expected := []byte("EOF 0 0\r\nEND\r\n")

  buf := new(bytes.Buffer)
  err := packet.Write(buf)
  if err != nil {
    t.Errorf("unexpected error while writing to buf `%s`", err)
    t.FailNow()
  }

  if !bytes.Equal(expected, buf.Bytes()) {
    t.Errorf("expected\n`%s`\n`%v`\ngot\n`%s`\n`%v`\n", expected, expected, buf.Bytes(), buf.Bytes())
    t.FailNow()
  }
}