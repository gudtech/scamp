package scamp

import "testing"

func TestGenerateMessageId(t *testing.T) {
	req := Request{}
	req.GenerateMesageId()
	if req.MessageId == "" || len(req.MessageId) != 18 {
		t.Errorf("MesasageId should have been 18-byte string but got `%s`", req.MessageId)
		t.FailNow()
	}
}

func TestHeaderRequestToPackets(t *testing.T) {
	req := Request{
		Action:         "hello.helloworld",
		envelopeFormat: ENVELOPE_JSON,
		Version:        1,
	}

	if req.MessageId != "" {
		t.Errorf("expected new req to have empty MessageId")
		t.FailNow()
	}

	pkts := req.ToPackets(0)
	if len(pkts) != 2 {
		t.Errorf("expected 2 packet")
		t.FailNow()
	}
	if req.MessageId == "" {
		t.Errorf("expected req to have MessageId")
		t.FailNow()
	}

	hdrPkt := pkts[0]
	if hdrPkt.packetType != HEADER {
		t.Errorf("expected HEADER type")
		t.FailNow()
	}
	if hdrPkt.packetmsgNoType != 0 {
		t.Errorf("header msgNo was %d but expected %d", hdrPkt.packetmsgNoType, 0)
		t.FailNow()
	}
	expectedHeader := PacketHeader{
		Action:    "hello.helloworld",
		Version:   1,
		MessageId: req.MessageId,
	}
	if hdrPkt.packetHeader != expectedHeader {
		t.Errorf("packetHeader was `%v` but expected `%v`", hdrPkt.packetHeader, expectedHeader)
		t.FailNow()
	}

	eofPkt := pkts[1]
	if eofPkt.packetType != EOF {
		t.Errorf("expected EOF type")
		t.FailNow()
	}
	if eofPkt.packetmsgNoType != 0 {
		t.Errorf("eof msgNo was %d but expected %d", eofPkt.packetmsgNoType, 0)
	}
}
