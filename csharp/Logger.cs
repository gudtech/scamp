using System;

// Mostly just a placeholder
namespace SCAMPUtil
{
	public static class Logger
	{
		public static void LogInfo(string fmt, params object[] args) {
			Console.Error.WriteLine (fmt, args);
		}
		public static void LogError(string fmt, params object[] args) {
			Console.Error.WriteLine (fmt, args);
		}
	}
}

