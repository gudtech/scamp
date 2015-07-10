using System;

namespace SCAMP.Metadata
{
	[Flags]
	public enum RPCActionFlags
	{
		Create    	= 1 << 0,
		Read		= 1 << 1,
		Update		= 1 << 2,
		Destroy		= 1 << 3,
		Public		= 1 << 4,
		NoAuth		= 1 << 5,
	}
}

