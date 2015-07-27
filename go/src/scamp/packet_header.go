package scamp

import "io"
import "encoding/json"
import "errors"
import "fmt"
import "bytes"

/******
  ENVELOPE FORMAT
******/

type EnvelopeFormat int

const (
	ENVELOPE_JSON EnvelopeFormat = iota
	ENVELOPE_JSONSTORE
)

var ENVELOPE_JSON_BYTES = []byte(`"json"`)
var ENVELOPE_JSONSTORE_BYTES = []byte(`"jsonstore"`)

func (envFormat EnvelopeFormat) MarshalJSON() (retval []byte, err error) {
	switch envFormat {
	case ENVELOPE_JSON:
		retval = ENVELOPE_JSON_BYTES
	case ENVELOPE_JSONSTORE:
		retval = ENVELOPE_JSONSTORE_BYTES
	default:
		err = errors.New(fmt.Sprintf("unknown format `%d`", envFormat))
	}

	return
}

func (envFormat *EnvelopeFormat) UnmarshalJSON(incoming []byte) error {
	if bytes.Equal(ENVELOPE_JSON_BYTES, incoming) {
		*envFormat = ENVELOPE_JSON
	} else if bytes.Equal(ENVELOPE_JSONSTORE_BYTES, incoming) {
		*envFormat = ENVELOPE_JSONSTORE
	} else {
		return errors.New(fmt.Sprintf("unknown envelope type `%s`", incoming))
	}
	return nil
}

/******
  MESSAGE TYPE
******/

type MessageType int

const (
	REQUEST MessageType = iota
	REPLY
)

var REQUEST_BYTES = []byte(`"request"`)
var REPLY_BYTES = []byte(`"reply"`)

func (messageType MessageType) MarshalJSON() (retval []byte, err error) {
	switch messageType {
	case REQUEST:
		retval = REQUEST_BYTES
	case REPLY:
		retval = REPLY_BYTES
	default:
		err = errors.New(fmt.Sprintf("unknown message type `%d`", messageType))
	}

	return
}

func (msgType *MessageType) UnmarshalJSON(incoming []byte) error {
	if bytes.Equal(REQUEST_BYTES, incoming) {
		*msgType = REQUEST
	} else if bytes.Equal(REPLY_BYTES, incoming) {
		*msgType = REPLY
	} else {
		return errors.New(fmt.Sprintf("unknown message type `%s`", incoming))
	}
	return nil
}

// Serialized to JSON and stuffed in the 'header' property
// of each packet
type PacketHeader struct {
	Action   string         `json:"action"`   // request
	Envelope EnvelopeFormat `json:"envelope"` // request
	// error  string        `json:"error"`            // reply
	// error_code []byte    `json:"error_code"`   // reply
	MessageId string `json:"request_id"` // both
	// station []byte       `json:"station"`         // request
	// ticket []byte        `json:"ticket"`           // request
	MessageType MessageType `json:"type"`    // both
	Version     int64       `json:"version"` // request
}

func (pktHdr *PacketHeader) Write(writer io.Writer) (err error) {
	jsonEncoder := json.NewEncoder(writer)
	err = jsonEncoder.Encode(pktHdr)

	return
}
