package scamp

import "net"
import "crypto/tls"

type ServiceAction func(*Session)

type Service struct {
	listener net.Listener
	actions map[string]ServiceAction
}

func NewService(port int64) (serv *Service, err error){
	serv = new(Service)
	serv.actions = make(map[string]ServiceAction)

	err = serv.listen(port)
	if err != nil {
		return
	}

	return
}

func (serv *Service)listen(port int64) (err error) {
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
		netConn,err := serv.listener.Accept()
		var tlsConn (*tls.Conn) = (netConn).(*tls.Conn)

		if tlsConn == nil {
			Error.Fatalf("could not create tlsConn")
		}

		conn,err := NewConnection(tlsConn)
		if err != nil {
			Error.Fatalf("error with new connection: `%s`", err)
		}


		go serv.HandleConnection(conn)
	}
}

func (serv *Service)HandleConnection(conn *connection) {
	Trace.Printf("whooo handling connection %s", conn)


}
