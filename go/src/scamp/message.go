package scamp

import "io"

type Message struct {
  header []byte
}

func NewMessage(reader *io.Reader) Message {
  headerBuf := make([]byte, 40)
  (*reader).Read(headerBuf)

  return Message{header: headerBuf}
}