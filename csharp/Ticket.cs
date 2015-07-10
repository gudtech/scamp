using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using SCAMP.Metadata;
using SCAMPUtil;
using SCAMP.Requesting;
using System.Collections.Generic;
using SCAMPUtil.JSON;

namespace SCAMP
{
	public sealed class Ticket
	{
		#region Ticket data

		string orig;
		uint version;
		uint user_id;
		uint client_id;
		double timestamp;
		double ttl;
		HashSet<uint> privs;

		public string String { get { return orig; } }

		public uint Version { get { return version; } }

		public uint UserID { get { return user_id; } }

		public uint ClientID { get { return client_id; } }

		public DateTime Timestamp { get { return new DateTime (1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds (timestamp); } }

		public double Ttl { get { return ttl; } }

		public DateTime Expires { get { return Timestamp.AddSeconds (ttl); } }

		public bool HasPrivilegeData { get { return privs != null; } }

		public override string ToString ()
		{
			return orig;
		}

		public uint[] GetPrivilegeIDs ()
		{
			return privs == null ? null : new List<uint> (privs).ToArray ();
		}

		public bool HasPrivilege (uint privilege)
		{
			return privs != null && privs.Contains (privilege);
		}

		public bool HasPrivilege (string privilege)
		{
			if (privilege == null)
				throw new ArgumentNullException ("privilege");

			uint pid;
			if (!GetPrivilegeID (privilege, out pid))
				return false;
			return HasPrivilege (pid);
		}

		private Ticket ()
		{
		}

		#endregion

		#region Auth service communications

		static Lazy<AuthzTable> authzTable = new Lazy<AuthzTable> (() => GetAuthzTable ());

		class AuthzTable
		{
			public Dictionary<uint,string> idToName;
			public Dictionary<string,uint> nameToId;
			public Dictionary<string,string[]> actionPrivDemand;
		}

		static AuthzTable GetAuthzTable ()
		{
			JObject raw = Requester.SyncJsonRequest ("Auth.getAuthzTable~1", null, new JObject ());
			var nl = raw ["_NAMES"].AsArray ();

			var t = new AuthzTable ();
			t.idToName = new Dictionary<uint,string> ();
			t.nameToId = new Dictionary<string,uint> ();
			t.actionPrivDemand = new Dictionary<string, string[]> ();

			for (int i = 0; i < nl.Count; i++) {
				string nm = nl [i].AsString (null);
				if (nm != null) {
					t.idToName [(uint)i] = nm;
					t.nameToId [nm] = (uint)i;
				}
			}

			foreach (var skey in raw.Keys) {
				var val = raw [skey] as JArray;
				if (val == null || skey.StartsWith ("_"))
					continue;
				List<string> perms = new List<string> ();
				foreach (var permstr in val) {
					int pi = (int)permstr.AsNumber (0);
					if (pi > 0)
						perms.Add (t.idToName [(uint) pi]);
				}
				t.actionPrivDemand [skey] = perms.ToArray ();
			}

			return t;
		}

		public static string GetPrivilegeName (uint privId)
		{
			return authzTable.Value.idToName [privId];
		}

		public static bool GetPrivilegeID (string name, out uint privId)
		{
			return authzTable.Value.nameToId.TryGetValue (name, out privId);
		}

		public static string[] GetActionPrivilegeDemand(ActionName ac) {
			if (ac == null)
				throw new ArgumentNullException ("ac");
			if (ac.Sector != "main")
				return null;
			string[] r;
			authzTable.Value.actionPrivDemand.TryGetValue ((ac.Namespace + '.' + ac.Name).ToLowerInvariant (), out r);
			return r;
		}

		class ApiKeyInfo
		{
			public Ticket tkt;
		}

		static Dictionary<string,ApiKeyInfo> apikeys = new Dictionary<string, ApiKeyInfo>();
		static object apikeys_lock = new object();

		public static Ticket ForApiKey (string apikey) {
			if (apikey == null)
				throw new ArgumentNullException (apikey);

			ApiKeyInfo inf;
			lock (apikeys_lock) {
				if (!apikeys.TryGetValue (apikey, out inf))
					apikeys [apikey] = inf = new ApiKeyInfo ();
			}

			lock (inf) {
				if (inf.tkt == null || inf.tkt.Expires < DateTime.UtcNow.AddSeconds (60)) {
					string[] parts = apikey.Split ('-');
					JObject loginRes = Requester.SyncJsonRequest ("User.login~1", null, new JObject {
						{ "type", "apikey" }, { "keystring", parts [0] }, { "secret", parts [1] }
					});
					Ticket authn = Verify (loginRes ["session"].AsString (null));
					if (authn == null)
						throw new RPCException ("internal", "Invalid session ticket returned from user.login");

					JObject authzRes = Requester.SyncJsonRequest ("Auth.authorize~1", null, new JObject {
						{ "ticket", authn.String }
					});
					Ticket authz = Verify (authzRes ["ticket"].AsString (null));
					if (authz == null)
						throw new RPCException ("internal", "Invalid session ticket returned from auth.authorize");
					inf.tkt = authz;
				}
				return inf.tkt;
			}
		}

		#endregion

		#region Cryptographic strings

		static readonly string KEY_PATH = "/etc/SCAMP/auth/ticket_verify_public_key.pem";
		static Lazy<RSACryptoServiceProvider> verifyKey =
			new Lazy<RSACryptoServiceProvider> (() => CryptoUtils.ParseX509PublicKey (File.ReadAllText (KEY_PATH, Encoding.ASCII)));

		static string VerifySignature (string ticketStr)
		{
			var m = Regex.Match (ticketStr, @"^(.*),([-_A-Za-z0-9]+)\z");
			if (!m.Success)
				return null;

			byte[] bts = Encoding.UTF8.GetBytes (m.Groups [1].Value);
			if (!verifyKey.Value.VerifyData (bts, "SHA256", CryptoUtils.FromBase64URL (m.Groups [2].Value)))
				return null;
			return m.Groups [1].Value;
		}

		public static Ticket Verify (string ticketStr)
		{
			if (ticketStr == null)
				return null;

			Ticket t = new Ticket ();
			t.orig = ticketStr;

			string body = VerifySignature (ticketStr);
			if (body == null)
				return null;

			string[] parts = body.Split (',');
			if (parts.Length < 5)
				return null;

			if (!uint.TryParse (parts [0], out t.version))
				return null;
			if (t.version != 1)
				return null;
			if (!uint.TryParse (parts [1], out t.user_id))
				return null;
			if (!uint.TryParse (parts [2], out t.client_id))
				return null;
			if (!double.TryParse (parts [3], out t.timestamp))
				return null;
			if (!double.TryParse (parts [4], out t.ttl))
				return null;

			if (parts.Length >= 6) {
				string[] pstr = parts [5].Split ('+');
				t.privs = new HashSet<uint> ();

				for (int i = 0; i < pstr.Length; i++) {
					uint ut;
					if (!uint.TryParse (pstr [i], out ut))
						return null;
					t.privs.Add (ut);
				}
			}

			return t;
		}

		#endregion
	}
}

