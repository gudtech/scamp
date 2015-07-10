using System;
using System.Text;
using System.Threading;
using SCAMP.Metadata;
using SCAMPUtil;
using System.Collections.Generic;
using SCAMPUtil.JSON;

namespace SCAMP.Requesting
{
	public static class Requester
	{
		static DiscoveryBase discovery = new PinboardDiscovery();
		static Dictionary<string, SOAClient> connections = new Dictionary<string, SOAClient> ();
		static object conn_lock = new object ();

		static SOAClient GetConnection (ServiceInfo si)
		{
			lock (conn_lock) {
				SOAClient cl;
				if (!connections.TryGetValue (si.URI, out cl) || cl.Closed) {
					Uri parsed = new Uri (si.URI);
					switch (parsed.Scheme) {
					case "scamp+tls":
						cl = new SCAMPSOAClient (parsed, si.Certificate);
						break;
					default:
						throw new RPCException ("general", "No connection handler available for scheme {0}", parsed.Scheme);
					}
					connections [si.URI] = cl;
				}
				return cl;
			}
		}
		// the JS requestor uses a "forwardRequest" concept which is almost certainly a premature optimization and not duplicated here
		static public void MakeRequest (RequestLocalOptions opts, ActionName act, string envelope, Message req, Action<Message> on_rpy)
		{
			ServiceInfo si;
			ActionInfo ai;

			if (!discovery.FindService (act, envelope, opts.TargetIdent, out si, out ai)) {
				req.Discard ();
				Message.StreamToCallback (on_rpy, new RPCException ("transport", "Action {0} not found", act).AsHeader ());
				return;
			}

			// important: aliases are processed here
			req.Header ["action"] = ai.Name.Namespace + '.' + ai.Name.Name;
			req.Header ["version"] = (double)ai.Name.Version;

			SOAClient client;
			try {
				client = GetConnection (si);
			} catch (Exception ex) {
				RPCException rpcex = RPCException.Wrap (ex);
				req.Discard ();
				Message.StreamToCallback (on_rpy,
					new RPCException ("transport", "Cannot establish connection", rpcex,
						RPCException.DispatchFailure ()).AsHeader ());
				return;
			}

			if (opts.Timeout == 0)
				opts.Timeout = ai.Timeout;

			client.Request (opts, req, on_rpy);
		}

		public static void MakeJsonRequest (ActionName act, JObject header, JObject payload, Action<RPCException, JObject> cb)
		{
			header = header ?? new JObject ();
			byte[] body;
			try {
				body = Encoding.UTF8.GetBytes (JSON.Stringify (payload));
			} catch (Exception ex) {
				cb (new RPCException ("transport", "cannot encode payload: {0}", ex), null);
				return;
			}

			Message m = new Message (header);
			MakeRequest (new RequestLocalOptions (), act, header ["envelope"].AsString ("json"), m, (resp) => {
				resp.Consume (10485760, (rpyheader, data, dlen, error) => {
					if (error != null) {
						cb (new RPCException ("transport", error), null);
						return;
					}

					if (rpyheader ["error_code"].AsString(null) != null) {
						cb (new RPCException (rpyheader), null);
						return;
					}

					JObject res = null;
					try {
						res = JSON.Parse (Encoding.UTF8.GetString (data, 0, dlen)).AsObject ();
					} catch (Exception) {
					}

					if (res == null) {
						cb (new RPCException ("transport", "failed to parse JSON response"), null);
						return;
					}

					cb (null, res);
				});
			});
			m.StreamData (body);
		}

		public static JObject SyncJsonRequest (string act, JObject header, JObject payload)
		{
			Logger.LogInfo ("REQ {0} {1} {2}", act, JSON.Stringify (header), JSON.Stringify (payload));
			using (var e = new ManualResetEvent (false)) {
				JObject result = null;
				RPCException exn = null;

				MakeJsonRequest (ActionName.Parse(act), header, payload, (ex, res) => {
					exn = ex;
					result = res;
					e.Set ();
				});

				e.WaitOne ();
				Logger.LogInfo ("RES {0} {1}", exn, JSON.Stringify (result));

				if (exn != null)
					throw exn;
				return result;
			}
		}
	}
}

