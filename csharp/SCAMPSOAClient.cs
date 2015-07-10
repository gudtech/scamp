using System;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using SCAMP.Transport.SCAMP;
using SCAMPUtil;
using System.Collections.Generic;

namespace SCAMP.Requesting
{
	public class SCAMPSOAClient : SOAClient
	{
		Uri parsed;
		public Protocol p;
		bool started;
		int nextid = 1;
		object state_lock = new object ();
		string closed_err;

		class RequestInfo
		{
			public Timer timeout;
			public Action<Message> cb;
		}

		Dictionary<string, RequestInfo> pending = new Dictionary<string, RequestInfo> ();

		public SCAMPSOAClient (Uri parsed, X509Certificate2 cert)
		{
			this.parsed = parsed;

			p = new Protocol ();
			p.OnClose += p_OnClose;
			p.OnMessage += p_OnMessage;

			NetUtil.TlsTcpConnect (parsed.Host, parsed.Port, (sender, certificate, chain, sslPolicyErrors) => certificate.GetCertHashString () == cert.Thumbprint, (ex, ssl) => {
				if (ex != null) {
					Logger.LogError ("Failed TLS connection to {0}: {1}", parsed, ex);
					p.Close (ex.ToString ());
				} else {
					lock (state_lock)
						started = true;
					p.Start (ssl);
				}
			});
		}

		public override bool Closed {
			get {
				lock (state_lock)
					return closed_err != null;
			}
		}

		public override void Request (RequestLocalOptions opt, Message req, Action<Message> on_rpy)
		{
			string id;
			string is_closed;
			lock (state_lock) {
				id = (nextid++).ToString ();
				is_closed = closed_err;
				if (is_closed == null) {
					pending [id] = new RequestInfo {
						cb = on_rpy,
						timeout = new Timer ((s) => {
							RequestTimedOut (id);
                        }, null, (opt.Timeout + 5) * 1000, Timeout.Infinite),
					};
				}
			}

			if (is_closed != null) {
				req.Discard ();
				Message.StreamToCallback (on_rpy, new RPCException ("transport", "Connection is closed", RPCException.DispatchFailure ()).AsHeader ());
			} else {
				req.Header ["request_id"] = id;
				req.Header ["type"] = "request";
				p.SendMessage (req);
			}
		}

		void RequestTimedOut (string id)
		{
			ResolveRequest (id, new RPCException ("transport", "RPC Timeout (request {0})", id), null);
		}

		void ResolveRequest (string id, RPCException ex, Message rpy)
		{
			RequestInfo ri;
			lock (state_lock) {
				if (pending.TryGetValue (id, out ri))
					pending.Remove (id);
				if (ri != null && ri.timeout != null) {
					ri.timeout.Dispose ();
					ri.timeout = null;
				}
			}

			if (ri == null) {
				if (rpy != null)
					rpy.Discard ();
				return;
			}

			if (ex != null) {
				Message.StreamToCallback (ri.cb, ex.AsHeader ());
			} else {
				ri.cb (rpy);
			}
		}

		void p_OnMessage (Message incoming)
		{
			string id = incoming.Header ["request_id"].AsString (null);
			if (id == null) {
				Logger.LogError ("Received reply with no request_id: {0}", parsed);
				incoming.Discard ();
				return;
			}

			ResolveRequest (id, null, incoming);
		}

		void p_OnClose (string error)
		{
			List<string> doomed;
			bool started;

			lock (state_lock) {
				closed_err = error ?? "";
				started = this.started;
				doomed = new List<string> (pending.Keys);
			}

			foreach (var id in doomed) {
				ResolveRequest (id, started ? new RPCException ("transport", "Connection lost") :
					new RPCException ("transport", "Connection could not be established", RPCException.DispatchFailure ()), null);
			}
		}
	}
}
