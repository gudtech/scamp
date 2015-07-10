using System;
using System.Text;
using SCAMPUtil.JSON;

namespace SCAMPUtil
{
    /// <summary>
    /// Represents a SOA core message.
    /// </summary>
    /// <remarks>A message object transfers a JSON object header, a lazy stream of bytes, and a trailing
    /// error from a producer to a consumer.  Threading details: Write operations must be serialized with
    /// respect to each other and with respect to consumer setup.  Ack operations do not need to be serialized,
    /// although the ack callback will be serialized internally.</remarks>
    public class Message
    {
        /// <summary>
        /// Used by streaming consumers to receive bytes as they become available.
        /// </summary>
        /// <remarks>It is essential that you call <see cref="Ack"/> when the data reaches an accumulation point.</remarks>
        /// <param name="buf">Data buffer.</param>
        /// <param name="offset">First byte of data to use.</param>
        /// <param name="length">Number of bytes to use.</param>
        public delegate void DataDelegate(byte[] buf, int offset, int length);

        /// <summary>
        /// Used by streaming consumers to receive indication of the end of data and the error trailer, if present.
        /// </summary>
        /// <param name="error">Error or <c>null</c>.</param>
        public delegate void EndDelegate(string error);

        /// <summary>
        /// Used by streaming producers to receive indication that data has reached an accumulation point.
        /// </summary>
        /// <remarks>Acknowledgment handlers are free to write data.  The system guarantees that data written from an ack
        /// handler will not result in additional ack calls until the first call returns.
        /// </remarks>
        /// <param name="nowAcked">Number of bytes acknowledged now.</param>
        /// <param name="prevAcked">Number of bytes that were acknowledged when this was last called.</param>
        public delegate void AckDelegate(long nowAcked, long prevAcked);

        /// <summary>
        /// Used by all-at-once consumers to receive everything.
        /// </summary>
        /// <param name="header">The message header.</param>
        /// <param name="data">Buffer containing received data.</param>
        /// <param name="dlen">Number of bytes of useful data, starting at offset 0.</param>
        /// <param name="error">Error trailer or <c>null</c>.</param>
		public delegate void FullDelegate(JObject header, byte[] data, int dlen, string error);

        /// <summary>
        /// The header associated with the message.
        /// </summary>
        /// <remarks>The object must be JSON conformant, and it is considered to be owned by the consumer (the consumer may modify and reuse it).</remarks>
		public JObject Header { get; private set; }

        /// <summary>
        /// Total bytes added to this message.
        /// </summary>
        public long TotalSent { get; private set; }

        /// <summary>
        /// Total bytes so far acknowledged.
        /// </summary>
        /// <remarks>The set acknowledgement delegate is called after this increases.</remarks>
        public long Acknowledged { get; private set; }

        // input
        AckDelegate onAck;
        object ackMutex;
        bool ackInProgress;

        // output
        bool ended;
        DataDelegate onData;
        EndDelegate onEnd;

        int maxBuffer;
        byte[] dataBuffer;
        int dataLength;
        FullDelegate onFull;

        /// <summary>
        /// Constructs a new message object.
        /// </summary>
        /// <param name="header">The header object (see <see cref="Header"/>).</param>
		public Message(JObject header)
        {
            if (header == null)
                throw new ArgumentNullException("header");
            this.Header = header;
        }

        /// <summary>
        /// True if a consumer has been attached to this message.
        /// </summary>
        public bool Consumed
        {
            get { return onFull != null || onEnd != null; }
        }

        /// <summary>
        /// Sets an acknowledgement callback, and optionally "primes the pump" by calling it to acknowledge 0 bytes.
        /// </summary>
        /// <remarks>It is not necessary to call this if you do not need acknowledgment information.</remarks>
        /// <param name="onack">Acknowledgment callback.</param>
        /// <param name="prime">True to call acknowledgement immediately.</param>
        public void BeginStream(AckDelegate onack, bool prime)
        {
            if (onack == null)
                throw new ArgumentNullException("onack");
            if (this.onAck != null)
                throw new InvalidOperationException("ack delegate already set");
            if (!Consumed)
                throw new InvalidOperationException("cannot stream without a consumer");
            this.onAck = onack;
            ackMutex = new object();
            if (prime)
                AckInternal(0, true);
        }

        /// <summary>
        /// Streams data into a message using streaming production.
        /// </summary>
        /// <param name="data">Buffer to pull data from</param>
        /// <param name="offset">Index of first byte to use</param>
        /// <param name="length">Count of bytes to use</param>
        public void AddData(byte[] data, int offset, int length)
        {
            if (data == null)
                throw new ArgumentNullException("data");
            if (offset < 0 || offset > data.Length)
                throw new ArgumentOutOfRangeException("offset");
            if (length < 0 || length > data.Length - offset)
                throw new ArgumentOutOfRangeException("length");
            if (! Consumed)
                throw new InvalidOperationException("cannot stream without a consumer");
            if (ended)
                throw new InvalidOperationException("trying to stream more data after end");

            TotalSent += length;

            if (onData != null)
            {
                onData(data, offset, length);
            }
            else
            {
                // immediately accounted for
                Ack(length);

                if (dataBuffer == null) // we're over the limit and silently eating now
                    return;

                if (length > maxBuffer - dataLength)
                {
                    // yow!  we just went over the buffer limit
                    Array.Resize(ref dataBuffer, maxBuffer);
                    Array.Copy(data, offset, dataBuffer, dataLength, maxBuffer - dataLength);
                    onFull(Header, dataBuffer, maxBuffer, "buffer limit exceeded");
                    dataBuffer = null;
                    return;
                }

                // since maxBuffer is not exceeded, we can't overflow in the add; overflow in the multiply is possible,
                // but is suppressed by the max
                if (length > dataBuffer.Length - dataLength)
                    Array.Resize(ref dataBuffer, Math.Min(maxBuffer, Math.Max(dataBuffer.Length * 2, dataLength + length)));
                Array.Copy(data, offset, dataBuffer, dataLength, length);
                dataLength += length;
            }
        }

        /// <summary>
        /// Marks the end of a streaming production.
        /// </summary>
        /// <param name="error">The error trailer or <c>null</c></param>
        public void End(string error)
        {
            if (! Consumed)
                throw new InvalidOperationException("cannot stream without a consumer");
            if (ended)
                throw new InvalidOperationException("tried to end more than once");

            ended = true;
            if (onData != null)
            {
                onEnd(error);
            }
            else
            {
                if (dataBuffer != null) // don't double end
                    onFull(Header, dataBuffer, dataLength, error);
                dataBuffer = null;
            }
        }

        const int WINDOW = 131072; // TODO should probably be set by the ultimate consumer and passed up
        /// <summary>
        /// Convenience function to stream data which is available immediately.
        /// </summary>
        /// <param name="data">The data to stream</param>
        /// <param name="error">Trailing error or <c>null</c></param>
        public void StreamData(byte[] data, string error = null)
        {
			bool ended = false;
            BeginStream((newack, oldack) =>
            {
                int sent = (int)TotalSent;
                int send = Math.Min(data.Length - sent, WINDOW - (sent - (int)newack));
                if (send > 0)
                    AddData(data, sent, send);
				if (!ended && sent + send >= data.Length) {
                    End(error);
					ended = true;
				}
            }, true);
        }

        /// <summary>
        /// Sets up a message for all-at-once consumption.
        /// </summary>
        /// <remarks>
        /// This function will cause the message object to buffer any data streamed to it until the message is done.
        /// To avoid threats of denial of service caused by buggy or maliciously large payloads, the payload size
        /// may be limited using the <paramref name="maxBuffer"/> argument.  If the limit is exceeded, the message
        /// will be truncated with an error.  Note that the limit is not used if the production mode is all-at-once.
        /// </remarks>
        /// <param name="maxBuffer">Maximum number of bytes to buffer</param>
        /// <param name="full">Callback to call after message is ready</param>
        public void Consume(int maxBuffer, FullDelegate full)
        {
            if (Consumed)
                throw new InvalidOperationException("consumption already started");
            if (maxBuffer < 0)
                throw new ArgumentOutOfRangeException("maxBuffer");
            if (full == null)
                throw new ArgumentNullException("full");

            onFull = full;
            this.maxBuffer = maxBuffer;
            this.dataBuffer = new byte[128];
        }

        /// <summary>
        /// Explicitly marks a message body as unwanted.
        /// </summary>
        public void Discard()
        {
            if (Consumed)
                throw new InvalidOperationException("consumption already started");
            onFull = Discarder;
            maxBuffer = 0;
            dataBuffer = new byte[0];
        }

		private void Discarder(JObject header, byte[] data, int dlen, string error)
        {
        }

        /// <summary>
        /// Sets up a message for streaming consumption.
        /// </summary>
        /// <param name="onData">Called whenever new data is available</param>
        /// <param name="onEnd">Called at the end of the message</param>
        public void Consume(DataDelegate onData, EndDelegate onEnd)
        {
            if (Consumed)
                throw new InvalidOperationException("consumption already started");
            if (onData == null)
                throw new ArgumentNullException("onData");
            if (onEnd == null)
                throw new ArgumentNullException("onEnd");

            this.onData = onData;
            this.onEnd = onEnd;
        }

        /// <summary>
        /// Announce that data has reached an accumulation point.
        /// </summary>
        /// <param name="bytes">Number of new bytes accumulated</param>
        public void Ack(long bytes) { AckInternal(bytes, false); }
        void AckInternal(long bytes, bool prime)
        {
            if (onAck == null)
                return;
            if (bytes < 0)
                throw new ArgumentOutOfRangeException("bytes");

            lock (ackMutex)
            {
                long prevAck = Acknowledged;
                Acknowledged += bytes;
                if (!ackInProgress)
                {
                    ackInProgress = true;
                    if (prime)
                        onAck(0,0);
                    while (Acknowledged > prevAck)
                    {
                        long newPrev = Acknowledged;
                        onAck(newPrev, prevAck);
                        prevAck = newPrev;
                    }
                    ackInProgress = false;
                }
            }
        }

		/// <summary>
		/// Utility to pass non-streaming data such as error reports to streaming callbacks.
		/// </summary>
		/// <param name="cb">A callback which expects to receive a streaming message.</param>
		/// <param name="hdr">The "message" header.</param>
		/// <param name="data">Message data if needed.</param>
		public static void StreamToCallback(Action<Message> cb, JObject hdr, byte[] data = null) {
			Message m = new Message (hdr);
			cb (m);
			m.StreamData (data ?? new byte[0]);
		}
    }
}
