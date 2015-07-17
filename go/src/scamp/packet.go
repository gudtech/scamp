package scamp

import "io"
import "bufio"
import "errors"
import "bytes"
import "strconv"
import "fmt"

type Packet struct {
  packetType []byte
  packetMsgNo int64
  body []byte
}

const (
  THE_REST_SIZE = 5

  // TODO: how to put literal byte array in const?
  // THE_REST_BYTES = []byte("END\r\n")
)

/*
  Will parse an io stream in to a packet struct
*/
func BuildPacket(reader io.Reader) (Packet,error) {
  bufRdr := bufio.NewReader(reader)

  pkt := Packet{}

  hdr,isPrefix,err := bufRdr.ReadLine()
  if err != nil {
    return Packet{},err
  }
  if isPrefix {
    return Packet{}, errors.New("header read was short. bailing out now.")
  }

  // Parse the header
  hdrChunks := bytes.Split(hdr, []byte(" "))
  if len(hdrChunks) != 3 {
    return Packet{}, errors.New("header must have 3 parts")
  }
  pkt.packetType = hdrChunks[0]

  parsedMsgNo, err := strconv.ParseInt(string(hdrChunks[1]), 10, 64)
  if err != nil {
    return Packet{}, err
  }
  pkt.packetMsgNo = parsedMsgNo

  bodyBytesNeeded, err := strconv.ParseInt(string(hdrChunks[2]), 10, 64)
  if err != nil {
    return Packet{}, err
  }

  // Use the msg len to consume the rest of the connection
  bodyBuf := make([]byte, bodyBytesNeeded)
  bytesRead := 0
  for {
    bytesReadNow, err := bufRdr.Read(bodyBuf[bytesRead:bodyBytesNeeded])

    fmt.Printf("bodyBytesNeeded: %d bytesReadNow: %d\n", bodyBytesNeeded, bytesReadNow)
    fmt.Printf("bodyBuf: `%s`\n", bodyBuf)

    if err != nil {
      return Packet{}, err
    }
    bytesRead = bytesRead + bytesReadNow

    if (bodyBytesNeeded - int64(bytesRead)) == 0 {
      break
    }
  }
  fmt.Printf("DONE\nbodyBuf: `%s`\n", bodyBuf)
  pkt.body = bodyBuf

  theRest := make([]byte, THE_REST_SIZE)
  bytesRead,err = bufRdr.Read(theRest)
  if bytesRead != THE_REST_SIZE || !bytes.Equal(theRest, []byte("END\r\n")) {
    return Packet{}, errors.New("packet was missing trailing bytes")
  }
  fmt.Printf("theRest: %s", theRest)

  return pkt,nil
}