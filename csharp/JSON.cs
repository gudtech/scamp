using System;
using System.Text;
using System.Globalization;
using System.Collections.Generic;
using System.Collections;
using System.Linq;

namespace SCAMPUtil.JSON
{
	[Serializable]
	public class JSONException : Exception
	{
		public JSONException ()
		{
		}

		public JSONException (string message) : base (message)
		{
		}

		public JSONException (string message, Exception inner) : base (message, inner)
		{
		}

		protected JSONException (
			System.Runtime.Serialization.SerializationInfo info,
			System.Runtime.Serialization.StreamingContext context)
			: base (info, context)
		{
		}
	}

	[Serializable]
	public class JSONParseException : JSONException
	{
		public JSONParseException ()
		{
		}

		public JSONParseException (string message) : base (message)
		{
		}

		public JSONParseException (string message, Exception inner) : base (message, inner)
		{
		}

		protected JSONParseException (
			System.Runtime.Serialization.SerializationInfo info,
			System.Runtime.Serialization.StreamingContext context)
			: base (info, context)
		{
		}
	}

	[Serializable]
	public class JSONQueryException : JSONException
	{
		public JSONQueryException ()
		{
		}

		public JSONQueryException (string message) : base (message)
		{
		}

		public JSONQueryException (string message, Exception inner) : base (message, inner)
		{
		}

		protected JSONQueryException (
			System.Runtime.Serialization.SerializationInfo info,
			System.Runtime.Serialization.StreamingContext context)
            : base (info, context)
		{
		}
	}

	public abstract class JNode
	{
		public virtual bool IsNull { get { return false; } }

		public virtual bool TryString (out string r)
		{
			r = null;
			return false;
		}

		public virtual bool TryNumber (out double d)
		{
			d = 0;
			return false;
		}

		public virtual bool AsBool ()
		{// not allowed to fail
			return true;
		}

		public string AsString ()
		{
			string r;
			if (!TryString (out r))
				throw new JSONQueryException ("Not a stringish value");
			return r;
		}

		public string AsString (string deflt)
		{
			string r;
			if (!TryString (out r))
				return deflt;
			return r;
		}

		public double AsNumber ()
		{
			double r;
			if (!TryNumber (out r))
				throw new JSONQueryException ("Not a numberish value");
			return r;
		}

		public double AsNumber (double deflt)
		{
			double r;
			if (!TryNumber (out r))
				return deflt;
			return r;
		}

		public virtual JArray AsArrayRO ()
		{
			return new JArray ();
		}

		public virtual JObject AsObjectRO ()
		{
			return new JObject ();
		}

		public virtual JArray AsArray ()
		{
			throw new JSONQueryException ("Not an array");
		}

		public virtual JObject AsObject ()
		{
			throw new JSONQueryException ("Not an object");
		}

		public static readonly JNode Null = new JNull ();
		public static readonly JNode True = new JBoolean (true);
		public static readonly JNode False = new JBoolean (false);

		public static implicit operator JNode (double v)
		{
			return new JNumber (v);
		}

		public static implicit operator JNode (string v)
		{
			return new JString (v);
		}

		public static implicit operator JNode (bool v)
		{
			return v ? True : False;
		}

		internal abstract void StringifyRecurse (StringBuilder sb);

		public override string ToString ()
		{
			return JSON.Stringify (this);
		}
	}

	public sealed class JNumber : JNode
	{
		double val;

		internal JNumber (double val)
		{
			if (double.IsInfinity (val) || double.IsNaN (val))
				throw new JSONQueryException ("JSON cannot represent infinities or NaNs");
			this.val = val;
		}

		public override bool TryString (out string s)
		{
			s = val.ToString ();
			return true;
		}

		public override bool AsBool ()
		{
			return val != 0;
		}

		public override bool TryNumber (out double d)
		{
			d = val;
			return true;
		}

		internal override void StringifyRecurse (StringBuilder sb)
		{
			sb.Append (val.ToString (NumberFormatInfo.InvariantInfo));
		}
	}

	public sealed class JString : JNode
	{
		string val;

		internal JString (string val)
		{
			this.val = val;
		}

		public override bool TryString (out string s)
		{
			s = val;
			return true;
		}

		public override bool AsBool ()
		{
			return val != "";
		}

		public override bool TryNumber (out double d)
		{
			return double.TryParse (val, out d);
		}

		internal override void StringifyRecurse (StringBuilder sb)
		{
			sb.Append ('"');
			foreach (char ch in val) {
				if (ch == '"' || ch == '\\' || char.IsControl (ch)) {
					sb.AppendFormat ("\\u{0:X4}", (int)ch);
				} else {
					sb.Append (ch);
				}
			}
			sb.Append ('"');
		}
	}

	public sealed class JBoolean : JNode
	{
		bool val;

		internal JBoolean (bool val)
		{
			this.val = val;
		}

		public override bool TryString (out string s)
		{
			s = val.ToString ();
			return true;
		}

		public override bool AsBool ()
		{
			return val;
		}

		public override bool TryNumber (out double d)
		{
			d = val ? 1 : 0;
			return true;
		}

		internal override void StringifyRecurse (StringBuilder sb)
		{
			sb.Append (val ? "true" : "false");
		}
	}

	public sealed class JNull : JNode
	{
		internal JNull ()
		{
		}

		public override bool IsNull { get { return true; } }

		internal override void StringifyRecurse (StringBuilder sb)
		{
			sb.Append ("null");
		}
	}
	// These have public constructors so that collection initializer syntax can be used
	public sealed class JObject : JNode, IDictionary<string, JNode>
	{
		Dictionary<string, JNode> children = new Dictionary<string, JNode> ();

		public JObject ()
		{
		}

		public override JObject AsObject ()
		{
			return this;
		}

		public override JObject AsObjectRO ()
		{
			return this;
		}

		public JObject ObjectAt (string key)
		{
			JNode n;
			if (children.TryGetValue (key, out n) && !n.IsNull) {
				return n.AsObject ();
			} else {
				var jo = new JObject ();
				children [key] = jo;
				return jo;
			}
		}

		public JArray ArrayAt (string key)
		{
			JNode n;
			if (children.TryGetValue (key, out n) && !n.IsNull) {
				return n.AsArray ();
			} else {
				var ja = new JArray ();
				children [key] = ja;
				return ja;
			}
		}

		#region IDictionary implementation

		public void Add (string key, JNode value)
		{
			children.Add (key, value ?? JNode.Null);
		}

		public bool ContainsKey (string key)
		{
			return children.ContainsKey (key);
		}

		public bool Remove (string key)
		{
			return children.Remove (key);
		}

		public bool TryGetValue (string key, out JNode value)
		{
			return children.TryGetValue (key, out value);
		}

		public JNode this [string index] {
			get {
				JNode r;
				return children.TryGetValue (index, out r) ? r : JNode.Null;
			}
			set {
				children [index] = value ?? JNode.Null;
			}
		}

		public ICollection<string> Keys {
			get {
				return children.Keys;
			}
		}

		public ICollection<JNode> Values {
			get {
				return children.Values;
			}
		}

		#endregion

		#region ICollection implementation

		void ICollection<KeyValuePair<string,JNode>>.Add (KeyValuePair<string, JNode> item)
		{
			(children as ICollection<KeyValuePair<string,JNode>>).Add (new KeyValuePair<string,JNode> (item.Key, item.Value ?? JNode.Null));
		}

		public void Clear ()
		{
			children.Clear ();
		}

		bool ICollection<KeyValuePair<string,JNode>>.Contains (KeyValuePair<string, JNode> item)
		{
			return (children as ICollection<KeyValuePair<string,JNode>>).Contains (new KeyValuePair<string,JNode> (item.Key, item.Value ?? JNode.Null));
		}

		void ICollection<KeyValuePair<string,JNode>>.CopyTo (KeyValuePair<string, JNode>[] array, int arrayIndex)
		{
			(children as ICollection<KeyValuePair<string,JNode>>).CopyTo (array, arrayIndex);
		}

		bool ICollection<KeyValuePair<string,JNode>>.Remove (KeyValuePair<string, JNode> item)
		{
			return (children as ICollection<KeyValuePair<string,JNode>>).Remove (new KeyValuePair<string,JNode> (item.Key, item.Value ?? JNode.Null));
		}

		public int Count {
			get {
				return children.Count;
			}
		}

		public bool IsReadOnly {
			get {
				return false;
			}
		}

		#endregion

		#region IEnumerable implementation

		public IEnumerator<KeyValuePair<string, JNode>> GetEnumerator ()
		{
			return children.GetEnumerator ();
		}

		#endregion

		#region IEnumerable implementation

		IEnumerator IEnumerable.GetEnumerator ()
		{
			return (children as IEnumerable).GetEnumerator ();
		}

		#endregion

		internal override void StringifyRecurse (StringBuilder sb)
		{
			sb.Append ('{');
			bool comma = false;
			foreach (var kv in children) {
				if (comma)
					sb.Append (',');
				(new JString(kv.Key)).StringifyRecurse (sb);
				sb.Append (':');
				kv.Value.StringifyRecurse (sb);
				comma = true;
			}
			sb.Append ('}');
		}
	}

	public sealed class JArray : JNode, IList<JNode>
	{
		List<JNode> children;

		public JArray ()
		{
			children = new List<JNode> ();
		}

		public JArray(IEnumerable<JNode> nodes) {
			children = new List<JNode> (nodes);
		}

		public JArray(IEnumerable<string> nodes) {
			children = new List<JNode> (nodes.Select (s => (JNode)s));
		}

		public override JArray AsArray ()
		{
			return this;
		}

		public override JArray AsArrayRO ()
		{
			return this;
		}

		public JObject ObjectAt (int key)
		{
			JNode n = this [key];
			if (n.IsNull)
				n = this [key] = new JObject ();
			return n.AsObject ();
		}

		public JArray ArrayAt (int key)
		{
			JNode n = this [key];
			if (!n.IsNull) {
				return n.AsArray ();
			} else {
				var ja = new JArray ();
				this [key] = ja;
				return ja;
			}
		}

		#region IList implementation

		public int IndexOf (JNode item)
		{
			return children.IndexOf (item);
		}

		public void Insert (int index, JNode item)
		{
			children.Insert (index, item ?? JNode.Null);
		}

		public void RemoveAt (int index)
		{
			children.RemoveAt (index);
		}

		public JNode this [int index] {
			get {
				return index < children.Count ? children [index] : JNode.Null;
			}
			set {
				while (children.Count <= index)
					children.Add (JNode.Null);
				children [index] = value ?? JNode.Null;
			}
		}

		#endregion

		#region ICollection implementation

		public void Add (JNode item)
		{
			children.Add (item ?? JNode.Null);
		}

		public void Clear ()
		{
			children.Clear ();
		}

		public bool Contains (JNode item)
		{
			return children.Contains (item ?? JNode.Null);
		}

		public void CopyTo (JNode[] array, int arrayIndex)
		{
			children.CopyTo (array, arrayIndex);
		}

		public bool Remove (JNode item)
		{
			return children.Remove (item ?? JNode.Null);
		}

		public int Count {
			get {
				return children.Count;
			}
		}

		public bool IsReadOnly {
			get {
				return false;
			}
		}

		#endregion

		#region IEnumerable implementation

		public IEnumerator<JNode> GetEnumerator ()
		{
			return children.GetEnumerator ();
		}

		#endregion

		#region IEnumerable implementation

		IEnumerator IEnumerable.GetEnumerator ()
		{
			return (children as IEnumerable).GetEnumerator ();
		}

		#endregion

		internal override void StringifyRecurse (StringBuilder sb)
		{
			bool comma = false;
			sb.Append ('[');
			foreach (var item in children) {
				if (comma)
					sb.Append (',');
				item.StringifyRecurse (sb);
				comma = true;
			}
			sb.Append (']');
		}
	}

	/// <summary>
	/// Dumb Javascript-style JSON parser and serializer.
	/// </summary>
	public class JSON
	{
		const int ROOT = 0;
		const int LIST_START = 1;
		const int LIST_ITEM = 2;
		const int LIST_COMMA = 3;
		const int HASH_START = 4;
		const int HASH_KEY = 5;
		const int HASH_COLON = 6;
		const int HASH_COMMA = 7;
		const int HASH_ITEM = 8;

		/// <summary>
		/// Parse a JSON string to generate objects.
		/// </summary>
		/// <param name="json">The JSON string</param>
		/// <returns>A .NET object</returns>
		public static JNode Parse (string json)
		{
			int rp = 0;
			int rmax = json.Length;
			int[] istack = new int[32];
			int isp = 0;
			object[] ostack = new object[32];
			int osp = 0;
			int state = ROOT;

			string key = null;
			JArray list = null;
			JObject hash = null;
			JNode item = null;

			StringBuilder sb;
			char ctmp;
			int itmp, jtmp;

			while (true) {
				while (rp < rmax && char.IsWhiteSpace (json [rp]))
					rp++;
				if (rp == rmax)
					throw new JSONParseException ("unexpected EOF at " + rp);

				switch (json [rp]) {
				case '[':
					if (isp + 2 > istack.Length)
						Array.Resize (ref istack, isp * 2);
					if (osp + 2 > ostack.Length)
						Array.Resize (ref ostack, osp * 2);
					istack [isp++] = state;
					ostack [osp++] = list;

					list = new JArray ();
					state = LIST_START;
					rp++;
					break;

				case '{':
					if (isp + 2 > istack.Length)
						Array.Resize (ref istack, isp * 2);
					if (osp + 2 > ostack.Length)
						Array.Resize (ref ostack, osp * 2);
					istack [isp++] = state;
					ostack [osp++] = key;
					ostack [osp++] = hash;

					hash = new JObject ();
					state = HASH_START;
					rp++;
					break;

				case ']':
					if (state == LIST_START || state == LIST_ITEM) {
						rp++;
						item = list;
						list = (JArray)ostack [--osp];
						state = istack [--isp];
						goto add_item;
					} else
						throw new JSONParseException ("unexpected CLOSE BRACKET at " + rp);

				case '}':
					if (state == HASH_START || state == HASH_ITEM) {
						rp++;
						item = hash;
						hash = (JObject)ostack [--osp];
						key = (string)ostack [--osp];
						state = istack [--isp];
						goto add_item;
					} else
						throw new JSONParseException ("unexpected CLOSE BRACE at " + rp);

				case ':':
					if (state == HASH_KEY)
						state = HASH_COLON;
					else
						throw new JSONParseException ("unexpected COLON at " + rp);
					rp++;
					break;

				case ',':
					if (state == HASH_ITEM)
						state = HASH_COMMA;
					else if (state == LIST_ITEM)
						state = LIST_COMMA;
					else
						throw new JSONParseException ("unexpected COMMA at " + rp);
					rp++;
					break;

				case 't':
					if (rp + 4 <= rmax && json.Substring (rp, 4) == "true") {
						item = true;
						rp += 4;
						goto add_item;
					}
					goto default;

				case 'f':
					if (rp + 5 <= rmax && json.Substring (rp, 5) == "false") {
						item = false;
						rp += 5;
						goto add_item;
					}
					goto default;

				case 'n':
					if (rp + 4 <= rmax && json.Substring (rp, 4) == "null") {
						item = null;
						rp += 4;
						goto add_item;
					}
					goto default;

				case '"':
					rp++;

					sb = new StringBuilder ();
					while (true) {
						if (rp == rmax)
							throw new JSONParseException ("unexpected EOF in string at " + rp);
						ctmp = json [rp];

						if (char.IsControl (ctmp))
							throw new JSONParseException ("control character in string at " + rp);
						rp++;

						if (ctmp == '"') {
							break;
						}
						if (ctmp != '\\') {
							sb.Append (ctmp);
							continue;
						}
						if (rp == rmax)
							throw new JSONParseException ("unexpected EOF in string at " + rp);

						switch (json [rp++]) {
						case '"':
							sb.Append ('"');
							break;
						case '\\':
							sb.Append ('\\');
							break;
						case '/':
							sb.Append ('/');
							break;
						case 'b':
							sb.Append ('\b');
							break;
						case 'f':
							sb.Append ('\f');
							break;
						case 'n':
							sb.Append ('\n');
							break;
						case 'r':
							sb.Append ('\r');
							break;
						case 't':
							sb.Append ('\t');
							break;
						case 'u':
							if (rp + 4 > rmax)
								throw new JSONParseException ("unexpected EOF in hex escape at " + rp);
							jtmp = 0;
							for (itmp = 0; itmp < 4; itmp++) {
								ctmp = json [rp++];
								jtmp = (jtmp << 4) + (int)ctmp;
								if (ctmp >= '0' && ctmp <= '9') {
									jtmp -= (int)'0';
								} else if (ctmp >= 'a' && ctmp <= 'f') {
									jtmp -= ((int)'a' - 10);
								} else if (ctmp >= 'A' && ctmp <= 'F') {
									jtmp -= ((int)'A' - 10);
								} else
									throw new JSONParseException ("invalid hex digit at " + rp);
							}
							sb.Append ((char)jtmp);
							break;
						default:
							throw new JSONParseException ("unknown backslash escape at " + rp);
						}
					}
					item = sb.ToString ();
					goto add_item;

				case '-':
				case '0':
				case '1':
				case '2':
				case '3':
				case '4':
				case '5':
				case '6':
				case '7':
				case '8':
				case '9':
					itmp = rp;
					if (rp < rmax && json [rp] == '-')
						rp++;

					if (rp < rmax && json [rp] == '0')
						rp++;
					else if (rp < rmax && json [rp] >= '1' && json [rp] <= '9') {
						rp++;
						while (rp < rmax && json [rp] >= '0' && json [rp] <= '9')
							rp++;
					} else
						throw new JSONParseException ("malformed number at " + rp);

					if (rp < rmax && json [rp] == '.') {
						rp++;
						if (rp < rmax && json [rp] >= '0' && json [rp] <= '9')
							rp++;
						else
							throw new JSONParseException ("malformed number at " + rp);

						while (rp < rmax && json [rp] >= '0' && json [rp] <= '9')
							rp++;
					}

					if (rp < rmax && (json [rp] == 'e' || json [rp] == 'E')) {
						rp++;
						if (rp < rmax && (json [rp] == '+' || json [rp] == '-'))
							rp++;

						if (rp < rmax && json [rp] >= '0' && json [rp] <= '9')
							rp++;
						else
							throw new JSONParseException ("malformed number at " + rp);

						while (rp < rmax && json [rp] >= '0' && json [rp] <= '9')
							rp++;
					}
					item = double.Parse (json.Substring (itmp, rp - itmp), NumberFormatInfo.InvariantInfo);
					goto add_item;

				default:
					throw new JSONParseException ("unrecognized token at " + rp);
				}
				continue;
				add_item:
				if (state == HASH_START || state == HASH_COMMA) {
					JString js = item as JString;
					if (js == null)
						throw new JSONParseException ("non-string hash key at " + rp);
					js.TryString (out key);
					state = HASH_KEY;
				} else if (state == HASH_COLON) {
					hash [key] = item;
					state = HASH_ITEM;
				} else if (state == LIST_START || state == LIST_COMMA) {
					list.Add (item);
					state = LIST_ITEM;
				} else if (state == ROOT) {
					while (rp < rmax && char.IsWhiteSpace (json [rp]))
						rp++;
					if (rp < rmax)
						throw new JSONParseException ("trailing garbage at " + rp);
					return item;
				} else {
					throw new JSONParseException ("unexpected ITEM at " + rp);
				}
				continue;
			}
		}

		public static string Stringify (JNode node)
		{
			StringBuilder sb = new StringBuilder ();
			(node ?? JNode.Null).StringifyRecurse (sb);
			return sb.ToString ();
		}
	}
}
