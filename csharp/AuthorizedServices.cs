using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using SCAMP.Metadata;
using SCAMPUtil;
using System.Collections.Generic;

namespace SCAMP.Requesting
{
	public class AuthorizedServices
	{
		Dictionary<string,Regex> compiledAuth = new Dictionary<string, Regex> ();
		DateTime snapshot;

		public AuthorizedServices () : this (null) { }

		AuthorizedServices (DateTime? stamp)
		{
			var file = SOAConfig.Config.Get ("bus.authorized_services", null);
			snapshot = stamp ?? File.GetLastWriteTimeUtc (file);
			var lines = File.ReadAllLines (file, Encoding.UTF8);

			foreach (var line in lines) {

				var line2 = Regex.Replace (line, @"#.*", "").Trim ();
				if (line2 == "")
					continue;

				var topm = Regex.Match (line2, @"^([0-9A-F]{2}(?::[0-9A-F]{2}){19})\s+(.+)");
				if (!topm.Success) {
					Logger.LogError ("Malformed fingerprint part of authorized_services line: {0}", line);
					continue;
				}

				var fingerprint = topm.Groups [1].Value;
				StringBuilder rxb = new StringBuilder ();

				foreach (var tok in Regex.Split (topm.Groups [2].Value, @"\s*,\s*")) {
					string sector, name;
					Match m;
					if ((m = Regex.Match (tok, @":")).Success) {
						sector = m.Result ("$`");
						name = m.Result ("$'");
					} else {
						sector = "main";
						name = tok;
					}

					rxb.Append (Regex.Escape (sector) + ":" + (name == "ALL" ? ".*" : Regex.Escape (name) + @"(?:\.|$)") + "|");
				}

				rxb.Length--;
				compiledAuth [fingerprint] = new Regex (rxb.ToString (), RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
				//Logger.LogInfo ("parsed authorized_services line \"{0}\" -> {1} :: {2}", line, fingerprint, compiledAuth [fingerprint]);
			}
		}

		public bool IsAuthorized(ServiceInfo inf, ActionName act) {
			var cert = inf.Certificate;
			if (cert == null)
				return false;
			Regex checker;
			if (!compiledAuth.TryGetValue (CryptoUtils.Fingerprint (cert), out checker))
				return false;
			return checker.IsMatch (act.Sector + ':' + act.Namespace + '.' + act.Name);
		}

		public AuthorizedServices CheckStale() {
			DateTime stamp = File.GetLastAccessTimeUtc (SOAConfig.Config.Get ("bus.authorized_services", null));
			if (stamp == snapshot) {
				return this;
			} else {
				return new AuthorizedServices (stamp);
			}
		}
	}
}

