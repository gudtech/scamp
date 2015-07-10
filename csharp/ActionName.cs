using System;

namespace SCAMP.Metadata
{
	/// <summary>
	/// Represents the distinguishing name aspects of a SOA action.  Yes I felt like overengineering this a bit.
	/// </summary>
	public sealed class ActionName
	{
		/// <summary>
		/// Identifies the sector of the action (a set of namespaces which follow a set of rules).  In the text representation, this is the part before the colon.  Must not contain a colon.
		/// </summary>
		public readonly string Sector;
		/// <summary>
		/// The namespace.  In the text representation, this is the part before the last dot.  Namespaces beginning with _ are special to the system.
		/// </summary>
		public readonly string Namespace;
		/// <summary>
		/// The name of the action.  In the text representation, this appears after the last dot before the version.  Names beginning with _ are special to the system.
		/// </summary>
		public readonly string Name;
		/// <summary>
		/// The action version number, a positive number after the ~ in the text representation.
		/// </summary>
		public readonly uint Version;
		string identity;

		public ActionName (string sector, string ns, string name, uint ver)
		{
			if (sector == null)
				throw new ArgumentNullException ("sector");
			if (sector.IndexOf (':') >= 0)
				throw new ArgumentException ("sector contains a colon", "sector");
			if (ns == null)
				throw new ArgumentNullException ("ns");
			if (ns.IndexOf (':') >= 0)
				throw new ArgumentException ("namespace contains a colon", "ns");
			if (name == null)
				throw new ArgumentNullException ("name");
			if (name.IndexOf ('.') >= 0)
				throw new ArgumentException ("name contains a dot", "dot");
			if (ver == 0)
				throw new ArgumentOutOfRangeException ("ver");

			Sector = sector;
			Namespace = ns;
			Name = name;
			Version = ver;
			identity = ToString ().ToLowerInvariant ();
		}

		public override bool Equals (object obj)
		{
			ActionName other = obj as ActionName;
			return (other != null && identity == other.identity);
		}

		public static bool operator ==(ActionName left, ActionName right) {
			return object.Equals(left, right);
		}

		public static bool operator !=(ActionName left, ActionName right) {
			return !object.Equals(left, right);
		}

		public override int GetHashCode ()
		{
			return identity.GetHashCode ();
		}

		public override string ToString ()
		{
			return string.Format (Sector == "main" ? "{1}.{2}~{3}" : "{0}:{1}.{2}~{3}", Sector, Namespace, Name, Version);
		}

		public static bool TryParse (string inp, out ActionName ret)
		{
			ret = null;
			int colon = inp.IndexOf (':');
			int tilde = inp.LastIndexOf ('~', inp.Length - 1, inp.Length - (colon + 1));
			if (tilde < 0)
				return false;
			int ldot = inp.LastIndexOf ('.', tilde - 1, tilde - (colon + 1));
			if (ldot < 0)
				return false;
			uint ver;
			if (!uint.TryParse (inp.Substring (tilde + 1), out ver))
				return false;
			if (ver == 0)
				return false;
			try {
				ret = new ActionName (colon >= 0 ? inp.Substring (0, colon) : "main",
					inp.Substring (colon + 1, ldot - (colon + 1)), 
					inp.Substring (ldot + 1, tilde - (ldot + 1)),
					ver);
			} catch (Exception) {
				return false;
			}
			return true;
		}

		public static ActionName Parse (string inp)
		{
			ActionName ret;
			if (!TryParse (inp, out ret))
				throw new FormatException ();
			return ret;
		}
	}
}