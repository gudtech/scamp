package scamp

import "net"
import "crypto/tls"

type ServiceAction func(Request,*Session)

type Service struct {
	listener    net.Listener
	actions     map[string]ServiceAction
	sessChan (chan *Session)
}

func NewService(port int64) (serv *Service, err error){
	serv = new(Service)
	serv.actions = make(map[string]ServiceAction)
	serv.sessChan = make(chan *Session, 100)

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

	serv.listener,err = tls.Listen("tcp", ":30101", config)
	if err != nil {
		return err
	}

	return
}

func (serv *Service)Register(name string, action ServiceAction) {
	serv.actions[name] = action
}

func (serv *Service)Run() {
	go serv.RouteSessions()

	for {
		netConn,err := serv.listener.Accept()
		var tlsConn (*tls.Conn) = (netConn).(*tls.Conn)

		if tlsConn == nil {
			Error.Fatalf("could not create tlsConn")
		}
		conn,err := newConnection(tlsConn, serv.sessChan)
		if err != nil {
			Error.Fatalf("error with new connection: `%s`", err)
		}

		go conn.packetRouter(false, true)
	}
}

func (serv *Service)RouteSessions(){

	for {
		newSess := <- serv.sessChan
		go func(){
			var action ServiceAction

			Trace.Printf("waiting for request to be received")
			request,err := newSess.RecvRequest()
			if err != nil {
				Error.Printf("error receving request %d", err)
				return
			}
			Trace.Printf("request came in for action `%s`", request.Action)

			action = serv.actions[request.Action]
			if action != nil {
				action(request, newSess)
				newSess.Free()
			} else {
				Error.Printf("unknown action `%s`", request.Action)
			}
		}()
	}
}
