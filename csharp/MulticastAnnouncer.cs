using System;
using System.Net.Sockets;
using System.Net;
using System.Text;
using System.Threading;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using SCAMP.Metadata;
using SCAMPUtil;
using System.Collections.Generic;

namespace SCAMP.Service
{
	public class MulticastAnnouncer
	{
		Dictionary<IPAddress, UdpClient> sockets = new Dictionary<IPAddress, UdpClient> ();
		Dictionary<IPAddress, byte[]> packets = new Dictionary<IPAddress, byte[]> ();
		Timer tmr;
		ServiceInfo info;
		bool shuttingDown;
		IDictionary<IPAddress, string> serviceAddresses;

		public MulticastAnnouncer (ServiceInfo info, IDictionary<IPAddress, string> serviceAddresses)
		{
			this.info = info;
			this.serviceAddresses = serviceAddresses;

			foreach (var ip in SOAConfig.Config.BusDiscoveryAddresses) {
				try {
					var cl = new UdpClient (new IPEndPoint (ip, SOAConfig.Config.BusPort));
					cl.JoinMulticastGroup (SOAConfig.Config.BusMulticastGroup, ip);
					sockets [ip] = cl;
				} catch (Exception ex) {
					Logger.LogError ("Failed to create announce socket for {0}: {1}", ip, ex);
				}
			}

			tmr = new Timer (SendAnnouncements);
			Reset ();
		}

		public bool ShuttingDown {
			[MethodImpl (MethodImplOptions.Synchronized)]
			get { return shuttingDown; }
			[MethodImpl (MethodImplOptions.Synchronized)]
			set {
				shuttingDown = value;
				Reset ();
			}
		}

		public ServiceInfo ServiceInfo {
			[MethodImpl (MethodImplOptions.Synchronized)]
			get { return info; }
			[MethodImpl (MethodImplOptions.Synchronized)]
			set {
				info = value;
				Reset ();
			}
		}

		void Reset ()
		{
			packets.Clear ();
			tmr.Change (0, shuttingDown ? 100 : (int)info.SendInterval);
		}

		[MethodImpl (MethodImplOptions.Synchronized)]
		void SendAnnouncements (object state)
		{
			foreach (var kv in sockets) {
				if (!serviceAddresses.ContainsKey (kv.Key))
					continue;
				try {
					byte[] pkt;
					if (!packets.TryGetValue (kv.Key, out pkt)) {
						Logger.LogInfo ("BuildAnnouncePacket {0}", kv.Key);
						var uri = serviceAddresses [kv.Key];
						var text = info.CreateSignedPacket (uri, shuttingDown);
						packets [kv.Key] = pkt = CryptoUtils.ZlibCompress (Encoding.UTF8.GetBytes (text));
					}
					kv.Value.Send (pkt, pkt.Length, new IPEndPoint (SOAConfig.Config.BusMulticastGroup, SOAConfig.Config.BusPort));
				} catch (Exception ex) {
					Logger.LogError ("Failed to send announcement for {0}: {1}", kv.Key, ex.ToString ());
				}
			}
		}
	}
}

