package scamp

import "io"
import "bufio"
import "errors"
import "bytes"
import "strconv"
import "fmt"
import "encoding/json"

const (
  THE_REST_SIZE = 5

  // TODO: how to put literal byte array in const?
  // THE_REST_BYTES = []byte("END\r\n")
)

type Packet struct {
  packetType PacketType
  packetMsgNo int64
  packetHeader PacketHeader
  body []byte
}

type PacketType int
const (
  HEADER PacketType = iota
  DATA
  EOF
  TXERR
  ACK
)

var HEADER_BYTES = []byte("HEADER")
var DATA_BYTES = []byte("DATA")
var EOF_BYTES = []byte("EOF")
var TXERR_BYTES = []byte("TXERR")
var ACK_BYTES = []byte("ACK")

/*
  Will parse an io stream in to a packet struct
*/
func ReadPacket(reader io.Reader) (Packet,error) {
  var pktTypeBytes []byte
  var bodyBytesNeeded int

  pkt := Packet{}

  _,err := fmt.Fscanf(reader, "%s %d %d\n", &pktTypeBytes, &(pkt.packetMsgNo), &bodyBytesNeeded)
  if err != nil {
    return Packet{}, err
  }

  // TODO these bytes should be moved to a const
  if bytes.Equal(HEADER_BYTES, pktTypeBytes) {
    pkt.packetType = HEADER
  } else if bytes.Equal(DATA_BYTES, pktTypeBytes) {
    pkt.packetType = DATA
  } else if bytes.Equal(EOF_BYTES, pktTypeBytes) {
    pkt.packetType = EOF
  } else if bytes.Equal(TXERR_BYTES, pktTypeBytes) {
    pkt.packetType = TXERR
  } else if bytes.Equal(ACK_BYTES, pktTypeBytes) {
    pkt.packetType = ACK
  } else {
    return Packet{}, errors.New( fmt.Sprintf("unknown packet type `%s`", pktTypeBytes) )
  }

  bufRdr := bufio.NewReader(reader)

  // Use the msg len to consume the rest of the connection
  bodyBuf := make([]byte, bodyBytesNeeded)
  bytesRead := 0
  for {
    bytesReadNow, err := bufRdr.Read(bodyBuf[bytesRead:bodyBytesNeeded])

    if err != nil {
      return Packet{}, err
    }
    bytesRead = bytesRead + bytesReadNow

    if bodyBytesNeeded - bytesRead == 0 {
      break
    }
  }
  pkt.body = bodyBuf

  theRest := make([]byte, THE_REST_SIZE)
  bytesRead,err = bufRdr.Read(theRest)
  if bytesRead != THE_REST_SIZE || !bytes.Equal(theRest, []byte("END\r\n")) {
    return Packet{}, errors.New("packet was missing trailing bytes")
  }

  if pkt.packetType == HEADER {
    err := pkt.ParseHeaderManual()
    // err := pkt.ParseHeaderReflection()
    if err != nil {
      return Packet{}, err
    }
  }

  return pkt,nil
}

// Stefan thought I might need more fine-grained
// buffer control so I'm leaving this here for now
// until integration tests show its need one way or another
func ReadPacketDeprecated(reader io.Reader) (Packet,error) {
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

  // TODO these bytes should be moved to a const
  if bytes.Equal(HEADER_BYTES, hdrChunks[0]) {
    pkt.packetType = HEADER
  } else if bytes.Equal(DATA_BYTES, hdrChunks[0]) {
    pkt.packetType = DATA
  } else if bytes.Equal(EOF_BYTES, hdrChunks[0]) {
    pkt.packetType = EOF
  } else if bytes.Equal(TXERR_BYTES, hdrChunks[0]) {
    pkt.packetType = TXERR
  } else if bytes.Equal(ACK_BYTES, hdrChunks[0]) {
    pkt.packetType = ACK
  } else {
    return Packet{}, errors.New(fmt.Sprintf("unknown packet type `%s`", hdrChunks[0]))
  }

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

    if err != nil {
      return Packet{}, err
    }
    bytesRead = bytesRead + bytesReadNow

    if (bodyBytesNeeded - int64(bytesRead)) == 0 {
      break
    }
  }
  pkt.body = bodyBuf

  theRest := make([]byte, THE_REST_SIZE)
  bytesRead,err = bufRdr.Read(theRest)
  if bytesRead != THE_REST_SIZE || !bytes.Equal(theRest, []byte("END\r\n")) {
    return Packet{}, errors.New("packet was missing trailing bytes")
  }

  if pkt.packetType == HEADER {
    err := pkt.ParseHeaderManual()
    // err := pkt.ParseHeaderReflection()
    if err != nil {
      return Packet{}, err
    }
  }

  return pkt,nil
}

func (pkt *Packet)ParseHeaderManual() (err error) {
  header := PacketHeader{}

  var objmap map[string]*json.RawMessage
  err = json.Unmarshal(pkt.body, &objmap)
  if err != nil {
    return err
  }

  var action string
  err = json.Unmarshal(*objmap["action"], &action)  
  if err != nil {
    return err
  } else {
    header.action = action
  }

  var version int64
  err = json.Unmarshal(*objmap["version"], &version)  
  if err != nil {
    return err
  } else {
    header.version = version
  }

  var envelope string
  err = json.Unmarshal(*objmap["envelope"], &envelope)
  if err != nil {
    return err
  } else {
    switch envelope {
    case "json":
      header.envelope = ENVELOPE_JSON
    case "jsonstore":
      header.envelope = ENVELOPE_JSONSTORE
    default:
      return errors.New( fmt.Sprintf("envelope `%s` is not valid", envelope) )
    }
  }

  pkt.packetHeader = header

  return nil
}

// TODO: why does reflection-based decoding
// fail to extract any values?
func (pkt *Packet)ParseHeaderReflection() (err error) {
  header := PacketHeader{}

  pkt.packetHeader = header

  err = json.Unmarshal(pkt.body, &header)
  if err != nil {
    return
  }

  return
}



func (pkt *Packet)WritePacket(writer io.Writer) (written int, err error){
  var packet_type_bytes []byte
  switch pkt.packetType {
    case HEADER: 
      packet_type_bytes = HEADER_BYTES
  } 

  written, err = fmt.Fprintf(writer, "%s %d %d\n", packet_type_bytes, pkt.packetMsgNo, len(pkt.body))
  if err != nil {
    return
  }

  return
}
