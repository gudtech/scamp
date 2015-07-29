package scamp

import "io"
import "encoding/json"
import "errors"
import "fmt"
import "bytes"

/******
  ENVELOPE FORMAT
******/

type envelopeFormat int

const (
	ENVELOPE_JSON envelopeFormat = iota
	ENVELOPE_JSONSTORE
)

var ENVELOPE_JSON_bytes = []byte(`"json"`)
var ENVELOPE_JSONSTORE_bytes = []byte(`"jsonstore"`)

func (envFormat envelopeFormat) MarshalJSON() (retval []byte, err error) {
	switch envFormat {
	case ENVELOPE_JSON:
		retval = ENVELOPE_JSON_bytes
	case ENVELOPE_JSONSTORE:
		retval = ENVELOPE_JSONSTORE_bytes
	default:
		err = errors.New(fmt.Sprintf("unknown format `%d`", envFormat))
	}

	return
}

func (envFormat *envelopeFormat) UnmarshalJSON(incoming []byte) error {
	if bytes.Equal(ENVELOPE_JSON_bytes, incoming) {
		*envFormat = ENVELOPE_JSON
	} else if bytes.Equal(ENVELOPE_JSONSTORE_bytes, incoming) {
		*envFormat = ENVELOPE_JSONSTORE
	} else {
		return errors.New(fmt.Sprintf("unknown envelope type `%s`", incoming))
	}
	return nil
}

/******
  MESSAGE TYPE
******/

type messageType int

const (
	request messageType = iota
	reply
)

var request_bytes = []byte(`"request"`)
var reply_bytes = []byte(`"reply"`)

func (messageType messageType) MarshalJSON() (retval []byte, err error) {
	switch messageType {
	case request:
		retval = request_bytes
	case reply:
		retval = reply_bytes
	default:
		err = errors.New(fmt.Sprintf("unknown message type `%d`", messageType))
	}

	return
}

func (msgType *messageType) UnmarshalJSON(incoming []byte) error {
	if bytes.Equal(request_bytes, incoming) {
		*msgType = request
	} else if bytes.Equal(reply_bytes, incoming) {
		*msgType = reply
	} else {
		return errors.New(fmt.Sprintf("unknown message type `%s`", incoming))
	}
	return nil
}

// Serialized to JSON and stuffed in the 'header' property
// of each packet
type PacketHeader struct {
	Action   string         `json:"action"`   // request
	Envelope envelopeFormat `json:"envelope"` // request
	// error  string        `json:"error"`            // reply
	// error_code []byte    `json:"error_code"`   // reply
	MessageId string `json:"request_id"` // both
	// station []byte       `json:"station"`         // request
	// ticket []byte        `json:"ticket"`           // request
	messageType messageType `json:"type"`    // both
	Version     int64       `json:"version"` // request
}

func (pktHdr *PacketHeader) Write(writer io.Writer) (err error) {
	jsonEncoder := json.NewEncoder(writer)
	err = jsonEncoder.Encode(pktHdr)

	return
}
