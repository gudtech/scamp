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
  HEADER = iota
  DATA
  EOF
  TXERR
  ACK
)

type EnvelopeFormat int
const (
  ENVELOPE_JSON = iota
  ENVELOPE_JSONSTORE
)

// type MessageType int
// const (
//   REQUEST = iota
//   REPLY
// )

type PacketHeader struct {
  action string           `json:"action"`           // request
  envelope EnvelopeFormat `json:"envelope"`         // request
  // error  string           `json:"error"`            // reply
  // error_code []byte       `json:"error_code"`   // reply
  // messageId []byte        `json:"message_id"`    // both
  // station []byte          `json:"station"`         // request
  // ticket []byte           `json:"ticket"`           // request
  // messageType []byte      `json:"message_type"` // both
  version int64           `json:"version"`            // request
}

/*
  Will parse an io stream in to a packet struct
*/
func ReadPacket(reader io.Reader) (Packet,error) {
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
  if bytes.Equal([]byte("HEADER"), hdrChunks[0]) {
    pkt.packetType = HEADER
  } else if bytes.Equal([]byte("DATA"), hdrChunks[0]) {
    pkt.packetType = DATA
  } else if bytes.Equal([]byte("EOF"), hdrChunks[0]) {
    pkt.packetType = EOF
  } else if bytes.Equal([]byte("TXERR"), hdrChunks[0]) {
    pkt.packetType = TXERR
  } else if bytes.Equal([]byte("ACK"), hdrChunks[0]) {
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