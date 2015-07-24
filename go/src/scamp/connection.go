package scamp

import "errors"
import "crypto/tls"

type Connection struct {
	conn        *tls.Conn
	Fingerprint string
	msgCnt      int64
}

func (conn *Connection) Connect(connspec string) (err error) {
	config := &tls.Config{
		InsecureSkipVerify: true,
	}
	config.BuildNameToCertificate()

	conn.conn, err = tls.Dial("tcp", connspec, config)
	if err != nil {
		return
	}

	// TODO get the end entity certificate instead
	peerCerts := conn.conn.ConnectionState().PeerCertificates
	if len(peerCerts) != 1 {
		err = errors.New("new connection had more than one cert in chain")
	}

	peerCert := peerCerts[0]
	conn.Fingerprint = SHA1FingerPrint(peerCert)

	return
}

func (conn *Connection) SendRequest(req Request) (err error) {
	pkts := req.ToPackets()
	for _, pkt := range pkts {
		err = pkt.Write(conn.conn)
		if err != nil {
			return
		}
	}

	return
}

func (conn *Connection) RecvReply() Reply {
	reply := Reply{}
	reply.Read(conn.conn)

	return reply
}

func (conn *Connection) Close() {
	conn.conn.Close()
}
