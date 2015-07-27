package scamp

import "math/rand"

// TODO: Requests should come out of a request object pool
// which sets their message_id on retrieval
type Request struct {
	Action         string
	EnvelopeFormat EnvelopeFormat
	Version        int64
	MessageId      string
}

var letters = []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

func (req *Request) GenerateMesageId() {
	// http://stackoverflow.com/questions/22892120/how-to-generate-a-random-string-of-a-fixed-length-in-golang
	b := make([]rune, 18)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}

	req.MessageId = string(b)
}

func (req *Request) ToPackets(msgNo MsgNo) []Packet {
	if req.MessageId == "" {
		req.GenerateMesageId()
	}

	headerHeader := PacketHeader{
		Action:      req.Action,
		Envelope:    req.EnvelopeFormat,
		Version:     req.Version,
		MessageId:   req.MessageId,
		MessageType: REQUEST,
	}
	headerPacket := Packet{
		packetHeader: headerHeader,
		packetType:   HEADER,
		packetMsgNo:  msgNo,
	}

	eofPacket := Packet{
		packetType:  EOF,
		packetMsgNo: msgNo,
	}

	return []Packet{headerPacket, eofPacket}
}
