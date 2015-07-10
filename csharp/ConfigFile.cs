using System;
using System.IO;
using System.Text;
using System.Collections.Generic;

namespace SCAMPUtil
{
	public class ConfigFile
	{
		Dictionary<string,string> options = new Dictionary<string, string> ();
		string path;

		public ConfigFile (string name)
		{
			path = Path.IsPathRooted (name) ? name : "/etc/SCAMP/" + name + ".conf";
			foreach (string line in File.ReadAllLines (path, Encoding.UTF8)) {
				string tmp = line;
				int hash = tmp.IndexOf ('#');
				if (hash >= 0)
					tmp = tmp.Substring (0, hash);
				tmp = tmp.Trim ();
				if (tmp == "")
					continue;
				int equal = tmp.IndexOf ('=');

				if (equal < 0) {
					Console.Error.WriteLine ("Config line in {0} has no equals: {1}", path, line);
					continue;
				}

				string key = tmp.Substring (0, equal).Trim ();
				string value = tmp.Substring (equal + 1).Trim ();
				if (options.ContainsKey (key)) {
					Console.Error.WriteLine ("Duplicate config variable in {0}, using first instance: {1}", path, key);
					continue;
				}

				options [key] = value;
			}
		}

		public void SetOverride (string key, string value)
		{
			options [key] = value;
		}

		public string Get (string key, string def)
		{
			if (options.ContainsKey (key))
				return options [key];

			if (def != null)
				return def;

			throw new ConfigException (string.Format ("Config value {0} is required in {1}", key, path));
		}

		public int GetInt (string key, int? def)
		{
			int o;
			if (!int.TryParse (Get (key, def == null ? null : def.ToString ()), out o))
				throw new ConfigException (string.Format ("Config value {0} in {1} must be an integer", key, path));
			return o;
		}

		public class ConfigException : Exception
		{
			public ConfigException (string msg) : base (msg)
			{
			}
		}
	}
}

