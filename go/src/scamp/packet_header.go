package scamp

import "io"
import "encoding/json"

type EnvelopeFormat int
const (
  ENVELOPE_JSON EnvelopeFormat = iota
  ENVELOPE_JSONSTORE
)

// Serialized to JSON and stuffed in the 'header' property
// of each packet
type PacketHeader struct {
  action string           `json:"action"`           // request
  envelope EnvelopeFormat `json:"envelope"`         // request
  // error  string        `json:"error"`            // reply
  // error_code []byte    `json:"error_code"`   // reply
  messageId string        `json:"message_id"`    // both
  // station []byte       `json:"station"`         // request
  // ticket []byte        `json:"ticket"`           // request
  // messageType []byte   `json:"message_type"` // both
  version int64           `json:"version"`            // request
}

func (pktHdr *PacketHeader)Write(writer io.Writer) (err error) {
  jsonEncoder := json.NewEncoder(writer)
  jsonEncoder.Encode(pktHdr)

  return
}