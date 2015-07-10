using System;
using System.Text;

namespace SCAMP.Metadata
{
	public class ActionInfo
	{
		public readonly ActionName Name;
		public readonly object Handler;
		public readonly string FlagString;
		public readonly RPCActionFlags Flags;
		public readonly int Timeout;
		public const int DEFAULT_TIMEOUT = 60;

		public ActionInfo (ActionName name, string flagstr, object handler = null)
		{
			if (name == null)
				throw new ArgumentNullException ("name");
			if (flagstr == null)
				flagstr = "";

			Name = name;
			Handler = handler;
			FlagString = flagstr;
			ParseFlags (FlagString, out Flags, out Timeout);
		}

		public ActionInfo (ActionName name, RPCActionFlags flags, int timeout, object handler)
			: this (name, UnparseFlags (flags, timeout), handler)
		{
		}

		static void ParseFlags (string flagStr, out RPCActionFlags flags, out int timeout)
		{
			flags = 0;
			timeout = DEFAULT_TIMEOUT;

			foreach (var fl in flagStr.Split(',')) {
				int u;
				switch (fl) {
				case "read":
					flags |= RPCActionFlags.Read;
					break;
				case "update":
					flags |= RPCActionFlags.Update;
					break;
				case "destroy":
					flags |= RPCActionFlags.Destroy;
					break;
				case "public":
					flags |= RPCActionFlags.Public;
					break;
				case "create":
					flags |= RPCActionFlags.Create;
					break;
				case "noauth":
					flags |= RPCActionFlags.NoAuth;
					break;
				default:
					if (fl.StartsWith ("t") && int.TryParse (fl.Substring (1), out u) && u > 0) {
						timeout = u;
					}
					break;
				}
			}
		}

		static string UnparseFlags (RPCActionFlags flags, int timeout)
		{
			StringBuilder sb = new StringBuilder ();
			if ((flags & RPCActionFlags.Create) != 0)
				sb.Append ("create,");
			if ((flags & RPCActionFlags.Read) != 0)
				sb.Append ("read,");
			if ((flags & RPCActionFlags.Update) != 0)
				sb.Append ("update,");
			if ((flags & RPCActionFlags.Destroy) != 0)
				sb.Append ("destroy,");
			if ((flags & RPCActionFlags.NoAuth) != 0)
				sb.Append ("noauth,");
			if ((flags & RPCActionFlags.Public) != 0)
				sb.Append ("public,");
			if (timeout != DEFAULT_TIMEOUT) {
				sb.Append ('t');
				sb.Append (timeout);
				sb.Append (',');
			}

			return sb.Length == 0 ? "" : sb.ToString (0, sb.Length - 1);
		}

		public override string ToString ()
		{
			return string.Format ("{0} [{1}]", Name, FlagString);
		}
	}
}

