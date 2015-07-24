package scamp

import "errors"
import "io"
import "fmt"

type Reply struct {
	blob []byte
}

func (rep *Reply) Read(reader io.Reader) (packets []Packet, err error) {
	for {
		packet, err := ReadPacket(reader)
		if err != nil {
			err = errors.New(fmt.Sprintf("err reading packet: `%s`", err))
		}
		packets = append(packets, packet)

		if packet.packetType == EOF || packet.packetType == TXERR {
			break
		}
	}

	fmt.Printf("Neat. Read %d packets\n", len(packets))
	for i, pkt := range packets {
		fmt.Printf("Packet[%d]: `%s`\n", i, pkt.body)
	}

	return
}
