package scamp

type Request struct {
  Action string
  EnvelopeFormat EnvelopeFormat
  Version int64
}

func (req *Request) ToPackets() []Packet {
  header := Packet{
    packetType: HEADER,
    packetMsgNo: 0,
  }

  return []Packet{ header }
}
