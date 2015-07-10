using System;

namespace SCAMP.Service
{
	/// <summary>
	/// This attribute is present at the top level of your service to declare basic information.
	/// </summary>
	[AttributeUsage (AttributeTargets.Assembly, Inherited = false, AllowMultiple = true)]
	public sealed class RPCServiceAttribute : Attribute
	{
		/// <summary>
		/// Service sector, defaulting to "main".
		/// </summary>
		public string Sector { get; set; }
		/// <summary>
		/// A string which identifies your service implementation.  Defaults to the assembly basename.
		/// </summary>
		public string Identity { get; set; }
		/// <summary>
		/// If set, this defines a root namespace which is present in the .NET code but will be ignored in action names.
		/// </summary>
		public string DotNetNamespacePrefix { get; set; }
		/// <summary>
		/// List of envelope names to support.
		/// </summary>
		public string[] Envelopes { get; set; }

		public RPCServiceAttribute ()
		{
		}
	}
}

