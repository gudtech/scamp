package scamp

import "net"
import "crypto/tls"

type ServiceAction func(*Session)

type Service struct {
	listener net.Listener
	actions map[string]ServiceAction
}

func NewService() (serv *Service){
	serv = new(Service)
	serv.actions = make(map[string]ServiceAction)

	return
}

func (serv *Service)Listen(port int64) (err error) {
	cert, err := tls.LoadX509KeyPair( "/etc/SCAMP/services/helloworld.crt","/etc/SCAMP/services/helloworld.key" )
	if err != nil {
		return
	}

	config := &tls.Config{
		Certificates: []tls.Certificate{ cert },
	}

	serv.listener,err = tls.Listen("tcp", "127.0.0.1:30101", config)
	if err != nil {
		return err
	}

	return
}

func (serv *Service)Register(name string, action ServiceAction) {
	serv.actions[name] = action
}

func (serv *Service)AcceptRequests() {
	for {
		var tlsConn (*tls.Conn)
		var listener net.Listener = serv.listener
		netConn,err := serv.listener.Accept()
		tlsConn = (&netConn).(*tls.Conn)

		conn,err := NewConnection(tlsConn)
		if err != nil {
			Error.Fatalf("error with new connection: `%s`", err)
		}


		Trace.Println("got conn %s err %s", conn, err)
	}
}
