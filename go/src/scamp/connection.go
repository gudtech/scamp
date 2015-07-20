package scamp

import "fmt"
import "errors"

// import "net"
import "crypto/tls"
import "crypto/x509"

import "io/ioutil"

type Connection struct {
}

func (conn *Connection)Connect() (err error) {
  roots := x509.NewCertPool()
  pemData, err := ioutil.ReadFile("/etc/SCAMP/services/helloworld.crt")
  if err != nil {
    return
  }
  ok := roots.AppendCertsFromPEM(pemData)
  if !ok {
    err = errors.New("could not append cert")
    return
  }

  config := &tls.Config{
    RootCAs: roots,
    InsecureSkipVerify: true,
  }
  config.BuildNameToCertificate()

  listener, err := tls.Dial("tcp", "192.168.11.148:30330", config)
  if err != nil {
    return
  }

  fmt.Printf("sup listener %s", listener)

  return
}