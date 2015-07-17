package scamp

import "io"

const (
  HEADER_BYTES = 40
)

type Message struct {
  header []byte
}

func NewMessage(reader io.Reader) (Message, error) {
  headerBuf := make([]byte, HEADER_BYTES)
  hBytesRead,err := reader.Read(headerBuf)
  if err != nil || hBytesRead != HEADER_BYTES {
    return Message{},err
  }

  // Seems silly to make a 1 byte buffer
  // but ReadByte interface would have to be
  // brought in
  byteBuf := make([]byte,1)
  bBytesRead,err := reader.Read(byteBuf)
  if err != nil || bBytesRead != 1 {
    return Message{},err
  }

  return Message{header: headerBuf}, nil
}