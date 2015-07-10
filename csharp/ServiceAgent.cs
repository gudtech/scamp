using System;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using SCAMP.Metadata;
using SCAMPUtil;
using SCAMPUtil.JSON;
using System.Collections.Generic;

namespace SCAMP.Service
{
	public class ServiceAgent
	{
		ServiceInfo info;
		SCAMPSOAServer srv;
		MulticastAnnouncer ann;
		WorkQueue wq;

		public ServiceAgent ()
		{
		}

		public virtual void DoMain (string[] argv)
		{
			this.info = ScanServiceDescription (Assembly.GetCallingAssembly ());

			wq = new WorkQueue (20);
			srv = new SCAMPSOAServer (info.Certificate, OnMessage);
			ann = new MulticastAnnouncer (info, srv.Bindings);
			new ManualResetEvent (false).WaitOne ();
		}

		public bool ShuttingDown {
			get { return ann.ShuttingDown; }
			set { ann.ShuttingDown = value; }
		}

		protected virtual void OnMessage (Message req, Action<Message> rpy)
		{
            req.Consume (1000000, (header, data, dlen, error) => {
                RPCRequestInfo ri = new RPCRequestInfo {
                    RequestHeader = header,
                    RequestData = data,
                    RequestDataLength = dlen,
                    RequestError = error,
                    ResponseHeader = new JObject (),
                    ResponseData = new byte[0],
                };

                wq.Enqueue (() => {
                    try {
                        Execute (ri);
                    } catch (Exception ex) {
                        Logger.LogError ("{0} Exception: {1}", ri.ActionInfo == null ? "(action not yet determined)" : ri.ActionInfo.Name.ToString (), ex);
                        var rpcex = RPCException.Wrap (ex);
                        ri.ResponseHeader ["error_code"] = rpcex.ErrorCode;
                        ri.ResponseHeader ["error"] = rpcex.ErrorMessage;
                        ri.ResponseHeader ["error_data"] = rpcex.ErrorData;
                    }

                    Message.StreamToCallback (rpy, ri.ResponseHeader, ri.ResponseData);
                });
            });
		}

		protected virtual void Execute (RPCRequestInfo ri)
		{
			if (ri.RequestError != null)
				throw new RPCException ("transport", "Failed to receive request body: {0}", ri.RequestError);

			string q = info.Sector + ':' + ri.RequestHeader["action"].AsString("") + '~' + ri.RequestHeader["version"].AsString("1");
			ActionName acname;
			ActionName.TryParse (q, out acname);

			if (acname == null)
				throw new RPCException ("transport", "No valid action name in request");
			ActionInfo ai = info.LookupAction (acname);
			if (ai == null || ai.Name != acname)
				throw new RPCException ("transport", "No such action");

			ri.ActionInfo = ai;

			ActionInvokeDetails d = (ActionInvokeDetails)ai.Handler;

			JObject reqData = null;
			try {
				reqData = JSON.Parse (Encoding.UTF8.GetString (ri.RequestData, 0, ri.RequestDataLength)).AsObject();
			}
			catch (Exception) {
			}

			if (reqData == null)
				throw new RPCException ("transport", "Failed to parse JSON request body");

			CheckPermissions (ri, d);
			Logger.LogInfo ("Request {0}", ri.ActionInfo);

			JObject resData = d.Handler (ri, reqData);

			ri.ResponseData = Encoding.UTF8.GetBytes (JSON.Stringify (resData));
		}

		protected class ActionInvokeDetails
		{
			public string[] PermissionDemand;
			public Func<RPCRequestInfo, JObject, JObject> Handler;
		}

		protected virtual void CheckPermissions (RPCRequestInfo ri, ActionInvokeDetails d)
		{
			string[] demand = d.PermissionDemand;

			if (info.Sector == "main" && (ri.ActionInfo.Flags & RPCActionFlags.NoAuth) == 0) {
				// non-noauth actions in the main sector get permission demands from DB

				demand = Ticket.GetActionPrivilegeDemand (ri.ActionInfo.Name);
				if (demand == null)
					throw new RPCException ("authz", "action not configured: {0}", ri.ActionInfo.Name);
			}

			ri.EffectiveTicket = Ticket.Verify (ri.RequestHeader ["ticket"].AsString (null));

			if (demand != null) {
				if (ri.EffectiveTicket == null)
					throw new RPCException ("authn", "valid authn ticket required for accessing core services");
				foreach (string p in demand)
					if (!ri.EffectiveTicket.HasPrivilege (p))
						throw new RPCException ("authz", "access denied: need priv {0} for {1}", p, ri.ActionInfo.Name);
			}

			ri.TerminalToken = ri.RequestHeader ["terminal"].AsString (null);
			ri.RealTicket = Ticket.Verify (ri.RequestHeader ["identifying_token"].AsString (null)) ?? ri.EffectiveTicket;

			uint cid;
			if (ri.RealTicket != null && ri.RealTicket.ClientID != 0) {
				ri.ClientID = ri.RealTicket.ClientID;
			} else if ((cid = (uint)ri.RequestHeader["client_id"].AsNumber(0)) != 0) {
				ri.ClientID = cid;
			}
		}

		protected virtual ServiceInfo ScanServiceDescription (Assembly a)
		{
			var sattr = (RPCServiceAttribute)Attribute.GetCustomAttribute (a, typeof(RPCServiceAttribute));
			if (sattr == null)
				throw new Exception ("No RPCServiceAttribute defined for this service!");

			List<ActionInfo> ail = new List<ActionInfo> ();

			ScanAvailableActions (sattr, ail, a);

			if (ail.Count == 0)
				throw new Exception ("Probable configuration error: no actions found");

			return new ServiceInfo (
				null,
				sattr.Sector ?? "main",
				sattr.Identity ?? Regex.Replace (a.FullName, @",.*", "").ToLowerInvariant (),
				sattr.Envelopes ?? new [] { "json", "jsonstore", "extdirect" },
				ail.ToArray ()
			);
		}

		protected virtual void ScanAvailableActions (RPCServiceAttribute sattr, List<ActionInfo> ail, Assembly a)
		{
			var global_priv = new List<Attribute> (Attribute.GetCustomAttributes (a, typeof(RPCPrivilegeRequiredAttribute)));
			string nsremove = sattr.DotNetNamespacePrefix == null ? "" : sattr.DotNetNamespacePrefix + ".";

			foreach (var type in a.GetExportedTypes()) {
				var type_priv = new List<Attribute> (Attribute.GetCustomAttributes (type, typeof(RPCPrivilegeRequiredAttribute)));
				type_priv.AddRange (global_priv);
				var nsdefaults = (RPCNamespaceAttribute)Attribute.GetCustomAttribute (type, typeof(RPCNamespaceAttribute)) ?? new RPCNamespaceAttribute ();

				var nspace = nsdefaults.Namespace;
				if (nspace == null) {
					if (!type.FullName.StartsWith (nsremove))
						continue;
					nspace = type.FullName.Substring (nsremove.Length);
				}

				ScanType (ail, type, type_priv, sattr.Sector ?? "main", nspace, nsdefaults.Version != 0 ? nsdefaults.Version : 1);
			}
		}

		protected virtual void ScanType(List<ActionInfo> ail, Type type, List<Attribute> typePriv, string sector, string nspace, uint version) {
			foreach (var m in type.GetMethods(BindingFlags.Public | BindingFlags.Static)) {
				var action_meta = (RPCAttribute)Attribute.GetCustomAttribute (m, typeof(RPCAttribute));
				if (action_meta == null)
					continue;
				var action_priv = new List<Attribute> (Attribute.GetCustomAttributes (m, typeof(RPCPrivilegeRequiredAttribute)));
				action_priv.AddRange (typePriv);

				List<string> privs = new List<string> ();
				foreach (var pra in action_priv)
					privs.Add ((pra as RPCPrivilegeRequiredAttribute).Privilege);

				uint ver = action_meta.Version != 0 ? action_meta.Version : version;
				ActionName an = new ActionName (sector, nspace, action_meta.Name ?? m.Name, ver);

				ActionInvokeDetails d = new ActionInvokeDetails {
					PermissionDemand = privs.Count == 0 ? null : privs.ToArray (),
				};

				var dg = (Func<RPCRequestInfo, JObject, JObject>)
					Delegate.CreateDelegate (typeof(Func<RPCRequestInfo, JObject, JObject>), m, false);
				if (dg != null) {
					d.Handler = dg;
				} else {
					throw new Exception (string.Format ("Method {0}.{1} is marked as an RPC but does not have the correct signature", type, m));
				}

				ail.Add (new ActionInfo (an, action_meta.Flags, action_meta.Timeout != 0 ? action_meta.Timeout : ActionInfo.DEFAULT_TIMEOUT, d));
			}
		}
	}
}
