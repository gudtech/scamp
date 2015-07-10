using System;

namespace SCAMP.Service
{
	[AttributeUsage (AttributeTargets.Class, Inherited = false, AllowMultiple = false)]
	public sealed class RPCNamespaceAttribute : Attribute
	{
		public string Namespace { get; set; }
		public uint Version { get; set; }

		public RPCNamespaceAttribute ()
		{
		}
	}
}