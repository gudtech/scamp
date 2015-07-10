using System;
using System.Net;
using System.Net.Sockets;
using System.Net.Security;

namespace SCAMPUtil
{
	public static class NetUtil
	{
		public static void DnsResolve (string host, Action<Exception, IPAddress[]> cb)
		{
			try {
				Dns.BeginGetHostAddresses (host, (ar) => {
					IPAddress[] addy = null;
					try {
						addy = Dns.EndGetHostAddresses (ar);
					} catch (Exception ex) {
						cb (ex, null);
						return;
					}
					cb (null, addy);
				}, null);
			} catch (Exception ex) {
				cb (ex, null);
			}
		}

		public static void TcpConnect (string host, int port, Action<Exception, Socket> cb)
		{
			DnsResolve (host, (ex, addresses) => {
				if (ex != null) {
					cb (ex, null);
					return;
				}

				TcpConnect (addresses, 0, port, cb);
			});
		}

		public static void TcpConnect (IPAddress[] addresses, int ix, int port, Action<Exception, Socket> cb)
		{
			TcpConnect (addresses [ix], port, (ex, sock) => {
				if (ex == null || ix == addresses.Length - 1) {
					cb (ex, sock);
					return;
				}

				TcpConnect (addresses, ix + 1, port, cb);
			});
		}

		public static void TcpConnect (IPAddress address, int port, Action<Exception, Socket> cb)
		{
			Socket sock = null;
			try {
				sock = new Socket (address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
				sock.BeginConnect (address, port, (ar) => {
					try {
						sock.EndConnect (ar);
						sock.NoDelay = true;
					} catch (Exception ex) {
						sock.Dispose ();
						cb (ex, null);
						return;
					}
					cb (null, sock);
				}, null);
			} catch (Exception ex) {
				if (sock != null)
					sock.Dispose ();
				cb (ex, null);
				return;
			}
		}
		// guarantees to close the socket on error
		public static void TlsConnect (Socket sock, string host, RemoteCertificateValidationCallback rcvc, Action<Exception,SslStream> cb)
		{
			SslStream ssl = null;
			try {
				ssl = new SslStream (new NetworkStream (sock, true), false, rcvc);
				ssl.BeginAuthenticateAsClient (host, (ar) => {
					try {
						ssl.EndAuthenticateAsClient (ar);
					} catch (Exception ex) {
						ssl.Dispose ();
						sock.Dispose ();
						cb (ex, null);
						return;
					}
					cb (null, ssl);
				}, null);
			} catch (Exception ex) {
				if (ssl != null)
					ssl.Dispose ();
				sock.Dispose ();
				cb (ex, null);
			}
		}

		public static void TlsTcpConnect (string host, int port, RemoteCertificateValidationCallback rcvc, Action<Exception,SslStream> cb)
		{
			TcpConnect (host, port, (ex, sock) => {
				if (ex != null) {
					cb (ex, null);
				} else {
					TlsConnect (sock, host, rcvc, cb);
				}
			});
		}
	}
}