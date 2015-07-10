using System;
using System.Net;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using SCAMP.Transport.SCAMP;
using SCAMPUtil;
using System.Collections.Generic;

namespace SCAMP.Service
{
	public class SCAMPSOAServer
	{
		X509Certificate2 cert;
		Dictionary<IPAddress, string> bindings = new Dictionary<IPAddress, string> ();

		public IDictionary<IPAddress,string> Bindings {
			get {
				return bindings;
			}
		}

		public SCAMPSOAServer (X509Certificate2 cert, Action<Message,Action<Message>> reqh)
		{
			this.cert = cert;
			this.reqh = reqh;

			foreach (IPAddress ip in SOAConfig.Config.BusServiceAddresses) {
				Listen (ip);
			}
		}

		Action<Message,Action<Message>> reqh;

		void Listen (IPAddress ip)
		{
			Socket listener = null;
			bool bind_ok = false;
			int port = 0;

			int tries = SOAConfig.Config.GetInt ("scamp.bind_tries", 20);
			int minp = SOAConfig.Config.GetInt ("scamp.first_port", 30100);
			int maxp = SOAConfig.Config.GetInt ("scamp.first_port", 30399);

			Random r = new Random ();

			while (tries-- > 0 && !bind_ok) {
				port = r.Next (minp, maxp + 1);
				try {
					listener = new Socket (ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
					listener.Bind (new IPEndPoint (ip, port));
					listener.Listen (10);
					bind_ok = true;
					Logger.LogInfo("bound to {0}:{1}", ip, port);
				} catch (SocketException e) {
					if (e.SocketErrorCode != SocketError.AddressAlreadyInUse)
						throw;
				} finally {
					if (!bind_ok && listener != null)
						listener.Close ();
				}
			}

			if (!bind_ok)
				throw new Exception (string.Format ("Could not bind scamp-server socket for address {0}", ip));

			bindings [ip] = string.Format ("scamp+tls://{0}:{1}", ip, port);

			AcceptConnections (listener);
		}

		void AcceptConnections (Socket listener)
		{
			listener.BeginAccept ((IAsyncResult ar) => {
				try {
					ProcessConnection (listener, ar);
				} catch (Exception ex) {
					Logger.LogError ("scamp connection accept: {0}", ex.ToString ());
				}
				AcceptConnections (listener);
			}, null);
		}

		void ProcessConnection (Socket listener, IAsyncResult ar)
		{
			Socket ns = listener.EndAccept (ar);
			ns.NoDelay = true;
			SslStream ssl = new SslStream (new NetworkStream (ns, true));

			ssl.BeginAuthenticateAsServer (cert, (IAsyncResult ar2) => {
				try {
					ssl.EndAuthenticateAsServer (ar2);
					Protocol p = new Protocol ();
					p.OnMessage += (incoming) => {
						var hdr = incoming.Header;
						// TODO timeout handling
						if (hdr ["type"].AsString(null) != "request") {
							Logger.LogError ("received non-request");
							incoming.Discard ();
							return;
						}
						if (!hdr.ContainsKey ("request_id")) {
							Logger.LogError ("Received request with no request_id");
							incoming.Discard ();
							return;
						}
						var id = hdr ["request_id"];
						reqh (incoming, (reply) => {
							reply.Header ["type"] = "reply";
							reply.Header ["request_id"] = id;
							p.SendMessage (reply);
						});
					};
					p.OnClose += (error) => {
						Logger.LogInfo ("scamp connection closed: {0}", error);
					};
					p.Start (ssl);
				} catch (Exception ex) {
					Logger.LogError ("connection server authenticate: {0}", ex);
				}
			}, null);
		}
	}
}

