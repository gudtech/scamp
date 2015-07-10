using System;
using SCAMPUtil;

namespace SCAMP.Requesting
{
	public abstract class SOAClient
	{
		public abstract void Request (RequestLocalOptions opts, Message req, Action<Message> rpy);

		public abstract bool Closed { get; }
	}
}

