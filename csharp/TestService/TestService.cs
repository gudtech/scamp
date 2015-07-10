using System;
using System.Collections;
using System.Security.Cryptography.X509Certificates;
using System.Threading;
using SCAMP.Service;
using SCAMPUtil.JSON;
using SCAMP.Requesting;
using SCAMPUtil;

[assembly: RPCService (Sector = "soapoffload", Identity = "csharp", DotNetNamespacePrefix = "TestService")]
namespace TestService
{
	class SOATestService
	{
		public static void Main (string[] args)
		{
			new Thread (() => new ServiceAgent ().DoMain (args)).Start ();

			if (args.Length != 0 && args [0] == "1") {
				Thread.Sleep (5000);
				Requester.SyncJsonRequest ("soapoffload:CSharp.CSharpTest~1", null, new JObject ());
				var t1 = DateTime.UtcNow;
				for (int i = 0; i < 10000; i++)
					Requester.SyncJsonRequest ("soapoffload:CSharp.CSharpTest~1", null, new JObject ());
				Logger.LogInfo ("10000 rq in {0}", (DateTime.UtcNow - t1).TotalSeconds);

			}
		}
	}

	public class CSharp
	{
		[RPC]
		public static JObject CSharpTest (RPCRequestInfo c, JObject p)
		{
            Thread.Sleep ((int)p ["ms"].AsNumber (0.0));
			return new JObject {
				{ "hello", "world" }
			};
		}
	}
}
