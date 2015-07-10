using System;
using SCAMPUtil;
using System.Net.NetworkInformation;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;

namespace SCAMP
{
	public class SOAConfig : ConfigFile
	{
		public static SOAConfig Config = new SOAConfig ();
		Dictionary<string, IPAddress> iflookup = new Dictionary<string,IPAddress> ();
		IPAddress[] bus_discovery;
		IPAddress[] bus_service;
		int bus_port;
		IPAddress bus_mcast;
		IPAddress def_if;

		private SOAConfig () : base ("/etc/SCAMP/soa.conf")
		{
			foreach (var intf in NetworkInterface.GetAllNetworkInterfaces()) {
				var uic = intf.GetIPProperties ().UnicastAddresses;
				if (uic.Count == 0)
					continue;

				IPAddress addy = uic [0].Address;
				iflookup [intf.Id] = addy;

				if (addy.ToString ().StartsWith ("10.") || addy.ToString ().StartsWith ("192.168.")) {
					def_if = addy;
				}
			}

			IPAddress[] bus_common = ParseInterfaceList (Get ("bus.address", "")) ?? DefaultInterfaceList ();
			bus_discovery = ParseInterfaceList (Get ("discovery.address", "")) ?? bus_common;
			bus_service = ParseInterfaceList (Get ("service.address", "")) ?? bus_common;
			bus_port = GetInt ("discovery.port", 5555);
			bus_mcast = IPAddress.Parse (Get ("discovery.multicast_address", "239.63.248.106"));
		}

		public IPAddress[] BusDiscoveryAddresses {
			get {
				return bus_discovery;
			}
		}

		public IPAddress[] BusServiceAddresses {
			get {
				return bus_service;
			}
		}

		public int BusPort {
			get {
				return bus_port;
			}
		}

		public IPAddress BusMulticastGroup {
			get {
				return bus_mcast;
			}
		}

		private IPAddress[] DefaultInterfaceList() {
			if (def_if != null)
				return new [] { def_if };
			throw new Exception ("No appropriate interface for probing bus.address; please set explicitly");
		}

		private IPAddress[] ParseInterfaceList (string inp)
		{
			var tl = new List<IPAddress> ();
			foreach (var chunk in inp.Replace(" ","").Split(',')) {
				if (chunk.Length == 0)
					continue;
				IPAddress thisip;
				bool ok;

				if (chunk.StartsWith ("if:")) {
					ok = iflookup.TryGetValue (chunk.Substring (3), out thisip);
				} else {
					ok = IPAddress.TryParse (chunk, out thisip) && iflookup.ContainsValue (thisip);
				}

				if (!ok) {
					throw new Exception (string.Format ("Could not resolve {0} to an interface address", chunk));
				}

				tl.Add (thisip);
			}

			return tl.Count > 0 ? tl.ToArray () : null;
		}
	}
}

