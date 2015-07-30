package scamp

import "bytes"

type Session struct {
	msgNo msgNoType
	conn *connection
	packets []Packet
	replyChan (chan Reply)
	requestChan (chan Request)
}

func newSession(newMsgNo msgNoType, conn *connection) (sess *Session) {
	sess = new(Session)
	sess.msgNo = newMsgNo
	sess.conn = conn
	sess.replyChan = make(chan Reply)
	sess.requestChan = make(chan Request)
	return
}

func (sess *Session) SendRequest(req Request) (err error) {
	pkts := req.ToPackets(sess.msgNo)
	for _, pkt := range pkts {
		Trace.Printf("sending msgNo %d", pkt.msgNo)
		err = pkt.Write(sess.conn.conn)
		if err != nil {
			return
		}
	}

	return
}

func (sess *Session) SendReply(rep Reply) (err error) {
	pkts := rep.ToPackets(sess.msgNo)
	for _, pkt := range pkts {
		Trace.Printf("SENDING (%d, %s)", pkt.msgNo, pkt.packetType)
		err = pkt.Write(sess.conn.conn)
		if err != nil {
			return
		}
	}

	return
}

func (sess *Session) RecvReply() (rep Reply, err error) {
	rep = <-sess.replyChan
	return
}

func (sess *Session) RecvRequest() (req Request, err error){
	req = <- sess.requestChan
	return
}

func (sess *Session) Append(pkt Packet) {
	sess.packets = append(sess.packets, pkt)
}

func (sess *Session) DeliverReply() {
	dataBuf := new(bytes.Buffer)
	for _,pkt := range sess.packets[1:] {
		dataBuf.Write(pkt.body)
	}

	rep := Reply {
		Blob: dataBuf.Bytes(),
	}

	sess.replyChan <- rep
}

func (sess *Session) DeliverRequest() {
	hdrPkt := sess.packets[0].packetHeader

	req := Request {
		Action: hdrPkt.Action,

	}
	sess.requestChan <- req
}
