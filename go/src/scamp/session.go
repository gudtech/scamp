package scamp

type Session struct {
	msgNo msgNoType
	conn *connection
	packets []Packet
	replyChan (chan Reply)
}

func (sess *Session) SendRequest(req Request) (err error) {
	pkts := req.ToPackets(sess.msgNo)
	for _, pkt := range pkts {
		Trace.Printf("sending packetmsgNoType %d", pkt.packetmsgNoType)
		err = pkt.Write(sess.conn.conn)
		if err != nil {
			return
		}
	}

	return
}

func (sess *Session) Recv() (rep Reply, err error) {
	rep = <-sess.replyChan

	return
}

func (sess *Session) Append(pkt Packet) {
	sess.packets = append(sess.packets, pkt)
}

func (sess *Session) Deliver() {
	sess.replyChan <- Reply{}
}
