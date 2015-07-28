package scamp

import "errors"
import "crypto/tls"
import "fmt"
import "sync"

type MsgNo int64;

type Connection struct {
	conn        *tls.Conn
	Fingerprint string
	msgCnt      MsgNo

	sessDemuxMutex *sync.Mutex
	sessDemux    map[MsgNo](*Session)
}

func NewConnection(tlsConn *tls.Conn) (conn *Connection, err error) {
	conn.conn = tlsConn

	conn.sessDemuxMutex = new(sync.Mutex)
	conn.sessDemux = make(map[MsgNo](*Session))

	// TODO get the end entity certificate instead
	peerCerts := conn.conn.ConnectionState().PeerCertificates
	if len(peerCerts) != 1 {
		err = errors.New("new connection must have exactly one cert in the chain")
	}

	peerCert := peerCerts[0]
	conn.Fingerprint = SHA1FingerPrint(peerCert)

	go conn.PacketRouter()
	return
}

func Connect(connspec string) (conn *Connection, err error) {
	config := &tls.Config{
		InsecureSkipVerify: true,
	}
	config.BuildNameToCertificate()

	tlsConn, err := tls.Dial("tcp", connspec, config)
	if err != nil {
		return
	}

	conn,err = NewConnection(tlsConn)
	if err != nil {
		return
	}
	
	return
}

func (conn *Connection) PacketRouter() (err error) {
	var pkt Packet
	var sess *Session

	for {
		pkt, err = ReadPacket(conn.conn)
		if err != nil {
			err = errors.New(fmt.Sprintf("err reading packet: `%s`", err))
			return
		}

		conn.sessDemuxMutex.Lock()
		sess = conn.sessDemux[pkt.packetMsgNo]
		conn.sessDemuxMutex.Unlock()

		if sess == nil {
			err = errors.New(fmt.Sprintf("packet (msgNo: %d) has no corresponding session", pkt.packetMsgNo))
			return
		}

		if pkt.packetType == HEADER {
			Trace.Printf("(SESS %d) HEADER packet\n", pkt.packetMsgNo)
			sess.Append(pkt)
		} else if pkt.packetType == DATA {
			Trace.Printf("(SESS %d) DATA packet\n", pkt.packetMsgNo)
			sess.Append(pkt)
		} else if pkt.packetType == EOF {
			Trace.Printf("(SESS %d) EOF packet\n", pkt.packetMsgNo)
			sess.Deliver()
		} else if pkt.packetType == TXERR {
			Trace.Printf("(SESS %d) TXERR\n`%s`", pkt.packetMsgNo, pkt.body)
			sess.Deliver()
		} else {
			Trace.Printf("(SESS %d) unknown packet type %d\n", pkt.packetType)
		}
	}

	return
}

// !!!! Deprecated
func (conn *Connection) SendRequest(req Request) (err error) {
	pkts := req.ToPackets(0)
	for _, pkt := range pkts {
		err = pkt.Write(conn.conn)
		if err != nil {
			return
		}
	}

	return
}

// !!!! Deprecated
func (conn *Connection) RecvReply() (reply Reply, err error) {
	reply = Reply{}
	err = reply.Read(conn.conn)
	if err != nil {
		return
	}

	return
}

func (conn *Connection) NewSession() (sess *Session, err error) {
	sess = new(Session)

	sess.conn = conn

	sess.msgNo = conn.msgCnt
	conn.msgCnt = conn.msgCnt + 1

	sess.replyChan = make(chan Reply, 1)

	conn.sessDemux[sess.msgNo] = sess

	return
}

func (conn *Connection) Send(req Request) (sess *Session, err error) {
	// The lock must be held until the first packet is sent. 
	// With the current structure it will hold the lock until all
	// packets for req are sent
	conn.sessDemuxMutex.Lock()
	sess,err = conn.NewSession()
	if err != nil {
		return
	}

	err = sess.SendRequest(req)
	if err != nil {
		return
	}
	conn.sessDemuxMutex.Unlock()

	return
}

func (conn *Connection) Close() {
	conn.conn.Close()
}
