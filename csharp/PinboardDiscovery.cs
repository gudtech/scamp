using System;
using System.IO;
using System.Text;

namespace SCAMP.Requesting
{
	public class PinboardDiscovery : DiscoveryBase
	{
		public PinboardDiscovery () : base (false)
		{
			// first attempt to look up anything will hit TimeCheck
		}

		DateTime lastRead;

		protected override void TimeCheck (DateTime now)
		{
			base.TimeCheck (now);

			if (lastRead > now.AddSeconds (-1))
				return;
			lastRead = now;

			var path = SOAConfig.Config.Get ("discovery.cache_path", null);
			var limit = SOAConfig.Config.GetInt ("discovery.cache_max_age", 120);
			var age = (now - File.GetLastWriteTimeUtc (path)).TotalSeconds;

			if (age > limit)
				throw new Exception ("Stale discovery cache");

			StashServices ();
			var data = File.ReadAllText (path, Encoding.UTF8);
			foreach (var blob in data.Split(new [] { "\n%%%\n" }, 0)) {
				if (blob == "")
					continue;
				Insert (blob);
			}
			DropStash ();
		}
	}
}

