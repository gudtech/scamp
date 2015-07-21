package scamp

// import "fmt"
import "errors"

// import "net"
import "encoding/hex"
import "strings"

import "crypto/sha1"
import "crypto/tls"
import "crypto/x509"

type Connection struct {
  listener *tls.Conn
  Fingerprint string
}

func (conn *Connection)Connect() (err error) {
  config := &tls.Config{
    InsecureSkipVerify: true,
  }
  config.BuildNameToCertificate()

  conn.listener, err = tls.Dial("tcp", "192.168.11.148:30330", config)
  if err != nil {
    return
  }

  peerCerts := conn.listener.ConnectionState().PeerCertificates
  if len(peerCerts) != 1 {
    err = errors.New("new connection had more than one cert in chain")
  }

  peerCert := peerCerts[0]
  conn.Fingerprint = SHA1FingerPrint(peerCert)

  return
}

func SHA1FingerPrint(cert *x509.Certificate) (hexSha1 string) {
  h := sha1.New()
  h.Write(cert.Raw)
  val := h.Sum(nil)
  rawHexEncoded := hex.EncodeToString(val)
  upperCased := strings.ToUpper(rawHexEncoded)
  upperCasedLen := len(upperCased)
  hexSha1 = ""

  for i,rune := range upperCased {
    hexSha1 = hexSha1 + string(rune)
    if i > 0 && i != upperCasedLen-1 && (i+1)%2 == 0 {
      hexSha1 = hexSha1 + ":"
    }
  }

  return
  // TODO: uncomment this code to see the struct is using SHA1withRSA
  // but why isn't that value usable? What am I missing?
  // fmt.Printf("using the built-in signature `%s`\n", hex.EncodeToString(cert.Signature))
  // fmt.Printf("built-in signature method is SHA1WithRSA: %s\n", cert.SignatureAlgorithm == x509.SHA1WithRSA)
  // fmt.Printf("built-in signature method is MD2WithRSA: %s\n", cert.SignatureAlgorithm == x509.MD2WithRSA)
  // fmt.Printf("built-in signature method is MD5WithRSA: %s\n", cert.SignatureAlgorithm == x509.MD5WithRSA)
  // fmt.Printf("built-in signature method is SHA1WithRSA: %s\n", cert.SignatureAlgorithm == x509.SHA1WithRSA)
  // fmt.Printf("built-in signature method is SHA256WithRSA: %s\n", cert.SignatureAlgorithm == x509.SHA256WithRSA)
  // fmt.Printf("built-in signature method is SHA384WithRSA: %s\n", cert.SignatureAlgorithm == x509.SHA384WithRSA)
  // fmt.Printf("built-in signature method is SHA512WithRSA: %s\n", cert.SignatureAlgorithm == x509.SHA512WithRSA)
  // fmt.Printf("built-in signature method is DSAWithSHA1: %s\n", cert.SignatureAlgorithm == x509.DSAWithSHA1)
  // fmt.Printf("built-in signature method is DSAWithSHA256: %s\n", cert.SignatureAlgorithm == x509.DSAWithSHA256)
  // fmt.Printf("built-in signature method is ECDSAWithSHA1: %s\n", cert.SignatureAlgorithm == x509.ECDSAWithSHA1)
  // fmt.Printf("built-in signature method is ECDSAWithSHA256: %s\n", cert.SignatureAlgorithm == x509.ECDSAWithSHA256)
  // fmt.Printf("built-in signature method is ECDSAWithSHA384: %s\n", cert.SignatureAlgorithm == x509.ECDSAWithSHA384)
  // fmt.Printf("built-in signature method is ECDSAWithSHA512: %s\n", cert.SignatureAlgorithm == x509.ECDSAWithSHA512)
}