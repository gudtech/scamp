using System;
using SCAMP.Metadata;

namespace SCAMP.Service
{
	[AttributeUsage (AttributeTargets.Method, AllowMultiple = false)]
	public sealed class RPCAttribute : Attribute
	{
		public string Name { get; set; }
		public uint Version { get; set; }
		public RPCActionFlags Flags { get; set; }
		public int Timeout { get; set; }

		public RPCAttribute ()
		{
		}
	}
}

