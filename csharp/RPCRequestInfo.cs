using System;
using SCAMP;
using SCAMP.Metadata;
using SCAMPUtil.JSON;

namespace SCAMP.Service
{
	public class RPCRequestInfo
	{
		// initialized very early, after message read
		public JObject RequestHeader { get; set; }

		public byte[] RequestData { get; set; }

		public int RequestDataLength { get; set; }

		public string RequestError { get; set; }
		// things for PreInvoke to fill out
		public ActionInfo ActionInfo { get; set; }
		public Ticket EffectiveTicket { get; set; }
		public string TerminalToken { get; set; }
		public Ticket RealTicket { get; set; }
		public uint ClientID { get; set; }
		// additional return for RPC call
		public JObject ResponseHeader { get; set; }

		public byte[] ResponseData { get; set; }
	}
}

