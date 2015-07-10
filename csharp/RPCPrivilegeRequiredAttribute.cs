using System;

namespace SCAMP.Service
{
	[AttributeUsage (AttributeTargets.Assembly | AttributeTargets.Class | AttributeTargets.Method, Inherited = false, AllowMultiple = true)]
	public sealed class RPCPrivilegeRequiredAttribute : Attribute
	{
		readonly string privilege;

		public string Privilege {
			get {
				return privilege;
			}
		}

		public RPCPrivilegeRequiredAttribute (string privilege)
		{
			this.privilege = privilege;
		}
	}
}

