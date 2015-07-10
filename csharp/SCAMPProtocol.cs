using System;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using SCAMPUtil;
using SCAMPUtil.JSON;
using System.Collections.Generic;

namespace SCAMP.Transport.SCAMP
{
    struct Queue
    {
        public byte[] Buffer;
        public int WP;
        public int RP; // WP >= RP

        public Queue(int initial)
        {
            Buffer = new byte[initial];
            RP = WP = 0;
        }

        public bool MakeRoom(int amount, int max)
        {
            int qty = WP - RP;

            if (amount > max - qty)
                return false;

            if (amount <= Buffer.Length - WP)
                return true; // already enough

            byte[] newBuffer = new byte[(qty + amount) * 3 / 2];

            Array.Copy(Buffer, RP, newBuffer, 0, WP - RP);
            Buffer = newBuffer;
            WP -= RP;
            RP = 0;

            return true;
        }
    }

    class PacketLayer
    {
		// all private functions not synchronized are preconditioned on having the lock

        #region Public API
        public PacketLayer()
        {
            readQueue = new Queue(128);
            writeQueue = new Queue(128);
            MaxWriteQueue = 16777216;
            ReadQuantum = 4096;
            MaxReadPacket = 131072;
        }

        public int MaxWriteQueue { get; set; }
        public int MaxReadPacket { get; set; }
        public int ReadQuantum { get; set; }

        [MethodImpl(MethodImplOptions.Synchronized)]
        public void SendPacket(string tag, long msgno, byte[] data, int offset, int len)
        {
            byte[] header  = Encoding.ASCII.GetBytes(tag + " " + msgno + " " + len + "\r\n");
            byte[] trailer = Encoding.ASCII.GetBytes("END\r\n");
            QueueWrite(header, 0, header.Length);
            QueueWrite(data, offset, len);
            QueueWrite(trailer, 0, 5);
        }
        public void SendPacket(string tag, long msgno, string data)
        {
            byte[] bdata = Encoding.UTF8.GetBytes(data);
            SendPacket(tag, msgno, bdata, 0, bdata.Length);
        }

        public delegate void PacketEventHandler(string tag, long msgno, byte[] data, int offset, int len);
        public event PacketEventHandler OnPacket;
        public event CloseEventHandler OnClose;
        #endregion

		#region Event sending
		WorkQueue evq = new WorkQueue();

		void RaiseCloseEvent(string why) {
			evq.Enqueue (() => {
				CloseEventHandler ch = OnClose;
				if (ch != null)
					ch (why);
			});
		}

		void RaisePacketEvent(string tag, long msgno, byte[] data, int offset, int len) {
			if (closed)
				return; // paranoia
			evq.Enqueue (() => {
				PacketEventHandler handler = OnPacket;
				if (handler != null)
					handler (tag, msgno, data, offset, len);
			});
		}
		#endregion

        #region Opening and closing
        Stream backing;

        [MethodImpl(MethodImplOptions.Synchronized)]
        public void Start(Stream backing)
        {
            this.backing = backing;
            StartRead();
            StartWrite();
        }

        bool closed;
		public bool Closed {
			get {
				lock (this)
					return closed;
			}
		}

        [MethodImpl(MethodImplOptions.Synchronized)]
        public void Close(string message)
        {
            if (closed) return;
            closed = true;
			if (backing != null) backing.Close();
            readQueue = writeQueue = default(Queue);
			RaiseCloseEvent (message);
        }

        #endregion
        #region Write queueing

        Queue writeQueue;
        bool writePending;

        void QueueWrite(byte[] data, int offset, int length)
        {
            if (closed) return;
            if (! writeQueue.MakeRoom(length, MaxWriteQueue))
            {
                Close("Write queue exceeded");
                return;
            }

            Array.Copy(data, offset, writeQueue.Buffer, writeQueue.WP, length);
            writeQueue.WP += length;
            StartWrite();
        }

        void StartWrite()
        {
            int len = writeQueue.WP - writeQueue.RP;
            if (closed || writePending || backing == null || len == 0)
				return;

            writePending = true;
            try
            {
                backing.BeginWrite(writeQueue.Buffer, writeQueue.RP, len, WriteComplete, len);
            }
            catch (Exception ioe)
            {
                Close(ioe.Message);
            }
        }

        [MethodImpl(MethodImplOptions.Synchronized)]
        void WriteComplete(IAsyncResult iar)
        {
            if (closed) return;
            try
            {
                backing.EndWrite(iar);
                writePending = false;
                writeQueue.RP += (int)iar.AsyncState;
                StartWrite();
            }
            catch (Exception ioe)
            {
                Close(ioe.Message);
            }
        }

        #endregion Write queueing
        #region Read queueing

        Queue readQueue;

        bool ProcessRead()
        {
            if (closed) return false;
            string header = Encoding.ASCII.GetString(readQueue.Buffer, readQueue.RP, Math.Min(80, readQueue.WP - readQueue.RP));

            int hlen = header.IndexOf("\r\n");
            if (hlen < 0)
            {
                if (header.Length >= 80) goto ill_formed; // overlong
                return false; // incomplete
            }
            header = header.Substring(0, hlen);
            string[] parts = header.Split(' ');
            if (parts.Length != 3) goto ill_formed;
            long msgno;
            int length;
            if (!long.TryParse(parts[1], out msgno) || msgno < 0 || parts[1] != msgno.ToString())
                goto ill_formed;
            if (!int.TryParse(parts[2], out length) || length < 0 || parts[2] != length.ToString())
                goto ill_formed;

            if (length > MaxReadPacket)
            {
                Close("Packet too large");
                return false;
            }

            if (readQueue.WP - readQueue.RP >= (hlen + length + 7))
            {
                if (Encoding.ASCII.GetString(readQueue.Buffer, readQueue.RP + hlen + 2 + length, 5) != "END\r\n")
                {
                    Close("Missing trailer");
                    return false;
                }
                int oldRP = readQueue.RP;
                readQueue.RP += (hlen + length + 7);
                // save this in case we reallocate before the task runs
				RaisePacketEvent (parts [0], msgno, readQueue.Buffer, oldRP + hlen + 2, length);
                return true;
            }
            else
            {
                return false;
            }

        ill_formed:
            Close("Malformed header");
            return false;
        }

        void StartRead()
        {
            if (closed) return;
            readQueue.MakeRoom(ReadQuantum, int.MaxValue);

            try
            {
                backing.BeginRead(readQueue.Buffer, readQueue.WP, ReadQuantum, ReadComplete, null);
            }
            catch (Exception ioe)
            {
                Close(ioe.ToString());
            }
        }

        [MethodImpl(MethodImplOptions.Synchronized)]
        void ReadComplete(IAsyncResult iar)
        {
            if (closed) return;

            try
            {
                int rd = backing.EndRead(iar);
                if (rd == 0)
                {
                    Close("EOF received");
                    return;
                }
                readQueue.WP += rd;
            }
            catch (Exception ioe)
            {
                Close(ioe.ToString());
                return;
            }

            while (ProcessRead()) ;
            StartRead();
        }

        #endregion
    }

	// packet layer no longer ever makes callbacks with the packet lock held, so we don't need to account for that
	// always call into packet layer with our lock held
    public class Protocol
    {
        class MsgInfo
        {
            public Message Message;
			public WorkQueue Seq;
            public bool Closed;
        }
        PacketLayer packet;
        long next_in, next_out;
        Dictionary<long, MsgInfo> incoming;
        Dictionary<long, MsgInfo> outgoing;
        bool closed;

        public Protocol()
        {
            packet = new PacketLayer();
            packet.OnClose += packet_OnClose;
            packet.OnPacket += packet_OnPacket;

            incoming = new Dictionary<long, MsgInfo>();
            outgoing = new Dictionary<long, MsgInfo>();
        }

        public void Start(Stream s)
        {
			lock (this)
				packet.Start (s);
        }

        public void Close(string why)
        {
			lock (this)
				packet.Close (why);
        }

        [MethodImpl(MethodImplOptions.Synchronized)]
        void packet_OnPacket(string tag, long msgno, byte[] data, int offset, int len)
        {
            if (closed) return;
            MsgInfo message;
			JObject hdr;

            if (tag == "HEADER")
            {
                if (msgno != next_in)
                {
                    packet.Close("Out of sequence message received");
                    return;
                }
                next_in++;

                try
                {
					hdr = JSON.Parse(Encoding.UTF8.GetString(data, offset, len)).AsObject();
                }
                catch (JSONException je)
                {
                    packet.Close("Malformed JSON in received header: " + je.Message);
                    return;
                }

				message = incoming[msgno] = new MsgInfo { Message = new Message(hdr), Seq = new WorkQueue() };
                message.Seq.Enqueue(() =>
                {
                    MessageEventHandler handler = OnMessage;
                    if (handler != null) handler(message.Message);
                    if (!message.Message.Consumed)
                        throw new InvalidOperationException("Recieved message was not handled");
                    message.Message.BeginStream((newack, oldack) =>
                    {
                        if (newack == oldack) return;
						lock (this)
							packet.SendPacket("ACK", msgno, newack.ToString());
                    }, false);
                });
            }
            else if (tag == "DATA")
            {
                if (!incoming.TryGetValue(msgno, out message))
                {
                    packet.Close("Received DATA with no active message");
                    return;
                }

                message.Seq.Enqueue(() =>
                {
                    if (!message.Closed)
                        message.Message.AddData(data, offset, len);
                });
            }
            else if (tag == "EOF")
            {
                if (!incoming.TryGetValue(msgno, out message))
                {
                    packet.Close("Received EOF with no active message");
                    return;
                }
                if (len > 0)
                {
                    packet.Close("EOF packet must be empty");
                    return;
                }
                message.Seq.Enqueue(() =>
                {
                    if (!message.Closed)
                    {
                        message.Message.End(null);
                        message.Closed = true;
                    }
                });
                incoming.Remove(msgno);
            }
            else if (tag == "TXERR")
            {
                if (!incoming.TryGetValue(msgno, out message))
                {
                    packet.Close("Received EOF with no active message");
                    return;
                }

                message.Seq.Enqueue(() =>
                {
                    if (!message.Closed)
                        message.Message.End(Encoding.UTF8.GetString(data, offset, len));
                    message.Closed = true;
                });
                incoming.Remove(msgno);
            }
            else if (tag == "ACK")
            {
                if (!outgoing.TryGetValue(msgno, out message))
                    return; // not an error, we may have finished sending

                string strbody = Encoding.ASCII.GetString(data, offset, len);
                long ackVal;
                if (!long.TryParse(strbody, out ackVal) || ackVal < 0 || ackVal.ToString() != strbody)
                {
                    packet.Close("Malformed ACK body");
                    return;
                }

                message.Seq.Enqueue(() =>
                {
                    if (ackVal <= message.Message.Acknowledged)
                    {
                        packet.Close("Attempt to move ACK pointer back");
                        return;
                    }
                    if (ackVal > message.Message.TotalSent)
                    {
                        packet.Close("Attempt to move ACK pointer past end of received data");
                        return;
                    }

                    message.Message.Ack(ackVal - message.Message.Acknowledged);
                });
            }
            else
            {
                packet.Close("Unexpected packet of type " + tag);
            }
        }

        [MethodImpl(MethodImplOptions.Synchronized)]
        void packet_OnClose(string error)
        {
            if (closed) return;
            foreach (MsgInfo broken in incoming.Values)
            {
                var bb = broken;
                bb.Seq.Enqueue(() =>
                {
                    if (!bb.Closed)
                    {
                        bb.Message.End("Connection closed before message finished");
                        bb.Closed = true;
                    }
                });
            }
            incoming = null;
            outgoing = null;
            closed = true;
            CloseEventHandler handler = OnClose;
            if (handler != null) handler.BeginInvoke(error, null, null);
        }

        public void SendMessage(Message message)
        {
            long id;
            lock (this)
            {
                if (closed)
                {
                    message.Discard();
                    return;
                }
                id = next_out++;
				outgoing[id] = new MsgInfo { Message = message, Seq = new WorkQueue() };
				packet.SendPacket("HEADER", id, JSON.Stringify(message.Header));
            }

            message.Consume(
                (data, offset, len) =>
                {
					lock (this)
						packet.SendPacket("DATA", id, data, offset, len);
                },
                (error) =>
                {
					lock(this) {
						packet.SendPacket(error == null ? "EOF" : "TXERR", id, error ?? "");
						if (!closed) outgoing.Remove(id);
					}
                }
            );
        }

        public event MessageEventHandler OnMessage;
        public event CloseEventHandler OnClose;
    }
    public delegate void MessageEventHandler(Message incoming);
    public delegate void CloseEventHandler(string error);
}
