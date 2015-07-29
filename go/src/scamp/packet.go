package scamp

import "io"
import "bufio"
import "errors"
import "bytes"
import "fmt"
import "encoding/json"

const (
	the_rest_size = 5
)

type Packet struct {
	packetType   PacketType
	packetmsgNoType  msgNoType
	packetHeader PacketHeader
	body         []byte
}

type PacketType int

const (
	HEADER PacketType = iota
	DATA
	EOF
	TXERR
	ACK
)

var header_bytes = []byte("HEADER")
var data_bytes = []byte("DATA")
var eof_bytes = []byte("EOF")
var txerr_bytes = []byte("TXERR")
var ack_bytes = []byte("ACK")
var the_rest_bytes = []byte("END\r\n")

/*
  Will parse an io stream in to a packet struct
*/
func ReadPacket(reader io.Reader) (Packet, error) {
	var pktTypeBytes []byte
	var bodyBytesNeeded int

	pkt := Packet{}

	_, err := fmt.Fscanf(reader, "%s %d %d\n", &pktTypeBytes, &(pkt.packetmsgNoType), &bodyBytesNeeded)
	if err != nil {
		return Packet{}, err
	}

	if bytes.Equal(header_bytes, pktTypeBytes) {
		pkt.packetType = HEADER
	} else if bytes.Equal(data_bytes, pktTypeBytes) {
		pkt.packetType = DATA
	} else if bytes.Equal(eof_bytes, pktTypeBytes) {
		pkt.packetType = EOF
	} else if bytes.Equal(txerr_bytes, pktTypeBytes) {
		pkt.packetType = TXERR
	} else if bytes.Equal(ack_bytes, pktTypeBytes) {
		pkt.packetType = ACK
	} else {
		return Packet{}, errors.New(fmt.Sprintf("unknown packet type `%s`", pktTypeBytes))
	}

	bufRdr := bufio.NewReader(reader)

	// Use the msg len to consume the rest of the connection
	bodyBuf := make([]byte, bodyBytesNeeded)
	bytesRead := 0
	for {
		bytesReadNow, err := bufRdr.Read(bodyBuf[bytesRead:bodyBytesNeeded])

		if err != nil {
			return Packet{}, err
		}
		bytesRead = bytesRead + bytesReadNow

		if bodyBytesNeeded-bytesRead == 0 {
			break
		}
	}
	pkt.body = bodyBuf

	theRest := make([]byte, the_rest_size)
	bytesRead, err = bufRdr.Read(theRest)
	if bytesRead != the_rest_size || !bytes.Equal(theRest, []byte("END\r\n")) {
		return Packet{}, errors.New("packet was missing trailing bytes")
	}

	if pkt.packetType == HEADER {
		err := pkt.ParseHeader()
		if err != nil {
			return Packet{}, err
		}
	}

	return pkt, nil
}

func (pkt *Packet) ParseHeader() (err error) {
	err = json.Unmarshal(pkt.body, &pkt.packetHeader)
	if err != nil {
		return
	}

	return
}

func (pkt *Packet) Write(writer io.Writer) (err error) {
	var packet_type_bytes []byte
	switch pkt.packetType {
	case HEADER:
		packet_type_bytes = header_bytes
	case EOF:
		packet_type_bytes = eof_bytes
	}

	var bodyBytes []byte
	bodyBytes = []byte("")

	bodyBuf := new(bytes.Buffer)
	// TODO this is why you use pointers so you can
	// carry nil values...
	emptyHeader := PacketHeader{}
	if pkt.packetHeader != emptyHeader {
		err = pkt.packetHeader.Write(bodyBuf)
		if err != nil {
			return
		}
		bodyBytes = bodyBuf.Bytes()
	}

	_, err = fmt.Fprintf(writer, "%s %d %d\r\n", packet_type_bytes, pkt.packetmsgNoType, len(bodyBytes))
	if err != nil {
		return
	}
	_, err = writer.Write(bodyBytes)
	if err != nil {
		return
	}

	_, err = writer.Write(the_rest_bytes)

	return
}
