using System;
using System.Runtime.CompilerServices;
using SCAMP.Metadata;
using SCAMPUtil;
using System.Collections.Generic;

namespace SCAMP.Requesting
{
	/// <summary>
	/// Manages a collection of services and receives signed blobs from the outside world.
	/// </summary>
	public abstract class DiscoveryBase
	{
		Dictionary<string,ServiceInfo> services = new Dictionary<string, ServiceInfo> ();
		Dictionary<string,ServiceInfo> servicesByID = new Dictionary<string, ServiceInfo> ();
		Dictionary<ServiceInfo,DateTime> expireTimes = new Dictionary<ServiceInfo, DateTime> ();
		Dictionary<string,ServiceInfo> stash;
		bool checkedReplace;
		AuthorizedServices auth = new AuthorizedServices ();
		readonly object stateLock = new object ();

		/// <summary>
		/// Creates a new discovery store, optionally with replacement checking enabled.
		/// </summary>
		/// <param name="checkReplace">If set to <c>true</c> inserts will check for replacing existing services.  This requires eager signature verification.</param>
		protected DiscoveryBase (bool checkReplace)
		{
			checkedReplace = checkReplace;
		}

		public ServiceInfo[] GetAllServices ()
		{
			lock (stateLock) {
				TimeCheck (DateTime.UtcNow);
				return new List<ServiceInfo> (services.Values).ToArray ();
			}
		}

		public bool FindService (ActionName wanted, string envelope, string ident, out ServiceInfo si, out ActionInfo ai)
		{
			lock (stateLock) {
				TimeCheck (DateTime.UtcNow);

				var cand = new List<ServiceInfo> ();
				foreach (var ssi in services.Values) {
					if (ident != null && ident != ssi.Identity)
						continue;
					ActionInfo sai = ssi.LookupAction (wanted);
					if (sai == null)
						continue;

					if (!auth.IsAuthorized (ssi, wanted))
						continue;
					if (!ssi.IsSignatureValid)
						continue;
					if (!ssi.Envelopes.Contains (envelope))
						continue;

					cand.Add (ssi);
				}

				si = null;
				ai = null;
				if (cand.Count == 0)
					return false;

				si = cand [new Random ().Next (cand.Count)];
				ai = si.LookupAction (wanted);
				return true;
			}
		}

		protected virtual void TimeCheck (DateTime now)
		{
			auth = auth.CheckStale ();

			if (checkedReplace) {
				foreach (var svc in new List<ServiceInfo> (services.Values)) {
					if (expireTimes [svc] < now) {
						expireTimes.Remove (svc);
						servicesByID.Remove (svc.DeduplicationKey);
						services.Remove (svc.Source);
					}
				}
			}
		}

		/// <summary>
		/// Clears the service list but saves the service object so as to avoid reevaluating signatures if the service is present in the new list.
		/// </summary>
		protected void StashServices ()
		{
			stash = services;
			services = new Dictionary<string, ServiceInfo> ();
			expireTimes = new Dictionary<ServiceInfo, DateTime> ();
			servicesByID = new Dictionary<string, ServiceInfo> ();
		}

		/// <summary>
		/// Delete stash after anything still useful has been reinserted.
		/// </summary>
		protected void DropStash ()
		{
			stash = null;
		}

		/// <summary>
		/// Receives a service blob into the store.
		/// </summary>
		/// <remarks>This should be called with the object lock held.</remarks>
		/// <param name="blob">Signed, uncompressed service blob.</param>
		protected void Insert (string blob)
		{
			// do we already have this exact blob?
			if (services.ContainsKey (blob))
				return;

			ServiceInfo inf = null;
			if (stash != null)
				stash.TryGetValue (blob, out inf);

			try {
				if (inf == null)
					inf = new ServiceInfo (blob);
			} catch (Exception ex) {
				Logger.LogInfo ("Failed to parse service blob {0}: {1}", blob, ex);
				return;
			}

			if (checkedReplace) {
				if (!inf.IsSignatureValid)
					return;
				string id = inf.DeduplicationKey;
				ServiceInfo old;
				if (servicesByID.TryGetValue (id, out old)) {
					if (inf.Timestamp <= old.Timestamp) {
						Logger.LogInfo ("Received new service blob for {0} with timestamp {1} but the newest seen timestamp is already {2}",
							id, inf.Timestamp, old.Timestamp);
						return;
					}

					servicesByID.Remove (id);
					services.Remove (old.Source);
				}
				servicesByID [id] = inf;
			}

			services [blob] = inf;
		}
	}
}

