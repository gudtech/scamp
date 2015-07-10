using System;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using SCAMPUtil;
using System.Collections.Generic;
using SCAMPUtil.JSON;

namespace SCAMP.Metadata
{
	/// <summary>
	/// Immutable, thread-safe object which represents the data from an announce packet.
	/// </summary>
	/// Server-side instances are additionally decorated with information to drive dispatch.
	public class ServiceInfo
	{
		bool serverInstance;
		// crypto stuff
		// must include private key on server side, won't on client
		X509Certificate2 serviceCert;
		string source;
		byte[] certData;
		byte[] signature;
		byte[] signedData;
		object signatureVerifyLock;
		// 1,0,-1
		int signatureValidity;
		// packet contents
		int packetVersion;
		// the server side version will have a random token appended
		string identity;
		string sector;
		double weight;
		double sendInterval;
		// not used on server due to multihoming
		string uri;
		string[] envelopes;
		JObject extensions;
		ActionInfo[] actions;
		double timestamp;
		// a cache
		Dictionary<ActionName, ActionInfo> actionLookup;

		public ServiceInfo (X509Certificate2 cert, string sector, string identity, string[] envelopes, ActionInfo[] actions)
		{
			serverInstance = true;
			serviceCert = cert ?? CryptoUtils.LoadKeyPair (SOAConfig.Config.Get (identity + ".soa_cert", null), SOAConfig.Config.Get (identity + ".soa_key", null));
			this.packetVersion = 3;
			this.identity = identity + ':' + CryptoUtils.RandomBase64 (24);
			this.sector = sector;
			this.weight = 1.0;
			this.sendInterval = 5000.0;
			this.envelopes = (string[])envelopes.Clone ();
			this.actions = (ActionInfo[])actions.Clone ();

			foreach (var ac in actions) {
				if (ac.Name.Sector != Sector)
					throw new ArgumentException ("action sector must match service sector");
			}

			CreateActionLookup ();
		}

		/// <summary>
		/// Initializes an instance of the <see cref="SCAMP.ServiceInfo"/> class to represent a received announce packet.
		/// </summary>
		/// <param name="signedPacket">Signed packet.</param>
		public ServiceInfo (string signedPacket)
		{
			source = signedPacket;
			string[] hunks = signedPacket.Split (new [] { "\n\n" }, StringSplitOptions.None);
			if (hunks.Length < 3)
				throw new FormatException ("at least 3 hunks required in signed message");

			serverInstance = false;
			certData = CryptoUtils.StripPEM (hunks [1]);
			signature = Convert.FromBase64String (hunks [2]);
			signedData = Encoding.UTF8.GetBytes (hunks [0]);
			signatureVerifyLock = new object ();

			JArray root;
			try {
				root = JSON.Parse (hunks [0]).AsArray ();
			} catch (JSONException) {
				throw new FormatException ("body must be a JSON array");
			}
			if (root.Count != 9)
				throw new FormatException (string.Format ("JSON body must have 9 elements, got {0}", root.Count));

			packetVersion = (int)root [0].AsNumber (0);
			if (packetVersion != 3)
				throw new FormatException (string.Format ("version number must be 3, got {0}", packetVersion));
			identity = root [1].AsString (null);
			if (identity == null)
				throw new FormatException ("identity (#1) must be a string");
			sector = root [2].AsString (null);
			if (sector == null)
				throw new FormatException ("sector (#2) must be a string");
			weight = root [3].AsNumber (0);
			sendInterval = root [4].AsNumber (0);
			uri = root [5].AsString (null);
			if (uri == null)
				throw new FormatException ("uri (#5) must be a string");
			JArray envelopes_and_extensions = root [6] as JArray;
			if (envelopes_and_extensions == null)
				throw new FormatException ("envelopes/extensions (#6) must be array");
			List<string> env = new List<string> ();
			foreach (var item in envelopes_and_extensions) {
				if (item is JString)
					env.Add (item.AsString ());
				if (item is JObject)
					extensions = item.AsObject ();
			}
			envelopes = env.ToArray ();

			JArray rawAc = root [7] as JArray;
			List<ActionInfo> acTmp = new List<ActionInfo> ();
			if (rawAc == null)
				throw new FormatException ("action list (#7) must be array");
			foreach (var nsitem in rawAc) {
				JArray rawNs = nsitem as JArray;
				if (rawNs == null)
					throw new FormatException ("namespace entry must be array");
				if (rawNs.Count == 0 || !(rawNs [0] is JString))
					throw new FormatException ("namespace entry must begin with a string");
				string ns = rawNs [0].AsString ();
				for (int i = 1; i < rawNs.Count; i++) {
					JArray rawAcItem = rawNs [i] as JArray;
					if (rawAcItem == null || rawAcItem.Count == 0 || !(rawAcItem [0] is JString))
						throw new FormatException ("action item must be list of length >0 starting with string");
					if (rawAcItem.Count >= 2 && !(rawAcItem [1] is JString))
						throw new FormatException ("action item flags must be string if present");

					string name = rawAcItem [0].AsString ();
					string flags = rawAcItem.Count >= 2 ? rawAcItem [1].AsString () : "";
					uint ver = (uint)rawAcItem [2].AsNumber (1);

					acTmp.Add (new ActionInfo (new ActionName (sector, ns, name, ver), flags));
				}
			}

			actions = acTmp.ToArray ();
			timestamp = root [8].AsNumber ();

			CreateActionLookup ();
		}

		void CreateActionLookup ()
		{
			actionLookup = new Dictionary<ActionName, ActionInfo> ();
			foreach (var act in actions) {
				actionLookup [act.Name] = act;
				// process aliasing flags
				foreach (var flag in act.FlagString.Split(',')) {
					if (flag == "create" || flag == "read" || flag == "update" || flag == "destroy")
						actionLookup [new ActionName (act.Name.Sector, act.Name.Namespace, '_' + flag, act.Name.Version)] = act;
				}
			}
		}

		public bool IsServerInfo { get { return serverInstance; } }

		public X509Certificate2 Certificate {
			get {
				if (serverInstance)
					return serviceCert;
				lock (signatureVerifyLock) {
					if (serviceCert == null) {
						try {
							serviceCert = new X509Certificate2 (certData);
						} catch (Exception) {
						}
					}
				
					return serviceCert;
				}
			}
		}

		public int PacketVersion { get { return packetVersion; } }

		public string Identity { get { return identity; } }

		public string Sector { get { return sector; } }

		public double Weight { get { return weight; } }

		public double SendInterval { get { return sendInterval; } }

		public string URI { get { return uri; } }

		public IList<string> Envelopes { get { return Array.AsReadOnly (envelopes); } }

		public IList<ActionInfo> Actions { get { return Array.AsReadOnly (actions); } }

		public double Timestamp { get { return timestamp; } }

		public string Source { get { return source; } }

		public override string ToString ()
		{
			X509Certificate2 cert = Certificate;
			return string.Format ("[ServiceInfo: {0} ({1}) ({2})]", Identity, cert == null ? "<invalid certificate>" : CryptoUtils.Fingerprint (cert), URI);
		}

		public string DeduplicationKey { get { return CryptoUtils.Fingerprint (Certificate) + ' ' + Identity; } }

		public ActionInfo LookupAction (ActionName name)
		{
			ActionInfo ai;
			return actionLookup.TryGetValue (name, out ai) ? ai : null;
		}

		public bool IsSignatureValid {
			get {
				if (serverInstance)
					throw new InvalidOperationException ("only request-side ServiceInfo can have signatures validated");
				lock (signatureVerifyLock) {
					if (signatureValidity == 0) {
						signatureValidity = -1;
						try {
							if (serviceCert == null)
								serviceCert = new X509Certificate2 (certData);
							var rsa = (RSACryptoServiceProvider)serviceCert.PublicKey.Key;
							if (rsa.VerifyData (signedData, "SHA256", signature))
								signatureValidity = 1;
							else
								Logger.LogInfo ("INVALID SIGNATURE for {0}", this);
						} catch (Exception e) {
							Logger.LogInfo ("Failed to verify signature (bad format?) for {0}: {1}", this, e);
						}
					}
					return signatureValidity > 0;
				}
			}
		}

		JArray EncodeActionList ()
		{
			var byNs = new Dictionary<string, JArray> ();

			foreach (var ac in actions) {
				JArray sublist;
				if (!byNs.TryGetValue (ac.Name.Namespace, out sublist)) {
					byNs [ac.Name.Namespace] = sublist = new JArray ();
					sublist.Add (ac.Name.Namespace);
				}

				sublist.Add (ac.Name.Version == 1 ? new JArray { ac.Name.Name, ac.FlagString } :
					new JArray { ac.Name.Name, ac.FlagString, ac.Name.Version });
			}

			return new JArray (byNs.Values);
		}

		string GetAnnounceJson (string uri, bool shuttingDown)
		{
			var env_ext = new JArray ();
			foreach (var e in envelopes)
				env_ext.Add (e);
			if (extensions != null)
				env_ext.Add (extensions);

			var data = new JArray {
				PacketVersion,
				Identity,
				Sector,
				shuttingDown ? 0.0 : Weight, // weight
				shuttingDown ? 0.1 : SendInterval,
				uri,
				env_ext,
				(uri != null && !shuttingDown) ? EncodeActionList () : new JArray(),
				(DateTime.UtcNow - new DateTime (1970, 1, 1)).TotalMilliseconds
			};

			return JSON.Stringify (data);
		}

		public string CreateSignedPacket (string uri, bool shuttingDown)
		{
			if (!IsServerInfo)
				throw new InvalidOperationException ("Cannot generate packets from non-server instances");

			string jsonPart = GetAnnounceJson (uri, shuttingDown);

			var rsa = (RSACryptoServiceProvider)Certificate.PrivateKey;
			return (
			    jsonPart + "\n\n" +
			    CryptoUtils.CertificateToPEM (Certificate) + "\n" +
			    CryptoUtils.Base64Folded (null, rsa.SignData (Encoding.UTF8.GetBytes (jsonPart), "SHA256"), 76) + "\n");
		}
	}
}
