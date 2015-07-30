package scamp

import "errors"
import "crypto/tls"
import "fmt"
import "sync"

type msgNoType int64;

type connection struct {
	conn        *tls.Conn
	Fingerprint string
	msgCnt      msgNoType

	sessDemuxMutex *sync.Mutex
	sessDemux    map[msgNoType](*Session)
	newSessions  (chan *Session)
}

// Establish secure connection to remote service.
// You must use the *connection.Fingerprint to verify the
// remote host
func Connect(connspec string) (conn *connection, err error) {
	config := &tls.Config{
		InsecureSkipVerify: true,
	}
	config.BuildNameToCertificate()

	tlsConn, err := tls.Dial("tcp", connspec, config)
	if err != nil {
		return
	}

	sessChan := make(chan *Session, 100)

	conn,err = newConnection(tlsConn, sessChan)
	if err != nil {
		return
	}
	go conn.packetRouter(true, false)
	
	return
}

func newConnection(tlsConn *tls.Conn, sessChan (chan *Session)) (conn *connection, err error) {
	conn = new(connection)
	conn.conn = tlsConn

	conn.sessDemuxMutex = new(sync.Mutex)
	conn.sessDemux = make(map[msgNoType](*Session))
	conn.newSessions = sessChan

	// TODO get the end entity certificate instead
	peerCerts := conn.conn.ConnectionState().PeerCertificates
	if len(peerCerts) == 1 {
		peerCert := peerCerts[0]
		conn.Fingerprint = sha1FingerPrint(peerCert)
	}

	return
}

// Demultiplex packets to their proper buffers.
func (conn *connection) packetRouter(ignoreUnknownSessions bool, isService bool) (err error) {
	var pkt Packet
	var sess *Session

	for {
		pkt, err = ReadPacket(conn.conn)
		if err != nil {
			Error.Printf("err reading packet: `%s`. Returning.", err)
			return
		}

		conn.sessDemuxMutex.Lock()
		sess = conn.sessDemux[pkt.msgNo]
		if sess == nil && !ignoreUnknownSessions {
			sess = newSession(pkt.msgNo, conn)
			conn.sessDemux[pkt.msgNo] = sess
			conn.sessDemuxMutex.Unlock()
			conn.newSessions <- sess // Could block and holding the DemuxMutex would block other tasks (namely: sending requests)
		} else {
			conn.sessDemuxMutex.Unlock()
		}

		if sess == nil && ignoreUnknownSessions {
			err = errors.New(fmt.Sprintf("packet (msgNo: %d) has no corresponding session", pkt.msgNo))
			continue
		}

		if pkt.packetType == HEADER {
			Trace.Printf("(SESS %d) HEADER packet\n", pkt.msgNo)
			sess.Append(pkt)
		} else if pkt.packetType == DATA {
			Trace.Printf("(SESS %d) DATA packet\n", pkt.msgNo)
			sess.Append(pkt)
		} else if pkt.packetType == EOF {
			Trace.Printf("(SESS %d) EOF packet\n", pkt.msgNo)
			// TODO: need polymorphism on Req/Reply so they can be delivered
			if isService {
				Trace.Printf("session delivering request")
				sess.DeliverRequest()
			} else {
				Trace.Printf("session delivering reply")
				go sess.DeliverReply()
			}
		} else if pkt.packetType == TXERR {
			Trace.Printf("(SESS %d) TXERR\n`%s`", pkt.msgNo, pkt.body)
			// TODO: need polymorphism on Req/Reply so they can be delivered
			if isService {
				sess.DeliverRequest()
			} else {
				go sess.DeliverReply()
			}
		} else {
			Trace.Printf("(SESS %d) unknown packet type %d\n", pkt.packetType)
		}
	}

	return
}

func (conn *connection) NewSession() (sess *Session, err error) {
	sess = new(Session)

	sess.conn = conn

	sess.msgNo = conn.msgCnt
	conn.msgCnt = conn.msgCnt + 1

	sess.replyChan = make(chan Reply, 1)

	conn.sessDemux[sess.msgNo] = sess

	return
}

func (conn *connection) Send(req Request) (sess *Session, err error) {
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

// Pulls full Requests out of master Request chan
// func (conn *connection) Recv() Session {
// 	return <-conn.sessionChan
// }

func (conn *connection) Close() {
	conn.conn.Close()
}

func (conn *connection) Recv() (sess *Session) {
	sess = <-conn.newSessions
	return
}

func (conn *connection) Free(sess *Session) {
	conn.sessDemuxMutex.Lock()
	msgNo := sess.packets[0].msgNo
	delete(conn.sessDemux, msgNo)
	conn.sessDemuxMutex.Unlock()
}
