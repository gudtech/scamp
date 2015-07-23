package scamp

// import "fmt"
import "errors"

// import "net"

import "crypto/tls"

type Connection struct {
  conn *tls.Conn
  Fingerprint string
}

func (conn *Connection)Connect() (err error) {
  config := &tls.Config{
    InsecureSkipVerify: true,
  }
  config.BuildNameToCertificate()

  conn.conn, err = tls.Dial("tcp", "192.168.1.138:30101", config)
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

func (conn *Connection)SendRequest(req Request) (err error) {
  pkts := req.ToPackets()
  for _,pkt := range pkts {
    err = pkt.Write(conn.conn)
    if err != nil {
      return
    }
  }


  return
}
