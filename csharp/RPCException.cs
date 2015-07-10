using System;
using SCAMPUtil;
using SCAMPUtil.JSON;

namespace SCAMP
{
	/// <summary>
	/// All errors thrown across the SCAMP system are of this form.
	/// </summary>
	public class RPCException : Exception
	{
		/// <summary>
		/// A short string which is machine readable but low in information content.
		/// </summary>
		/// Strings starting with an x_ are assumed to be meaningful only in the context of a specific action.
		public readonly string ErrorCode;
		/// <summary>
		/// A human-readable description of the problem.
		/// </summary>
		public readonly string ErrorMessage;
		/// <summary>
		/// Detailed machine-readable data.  May be null.  Keys starting with x_ are action-specific.
		/// </summary>
		public readonly JObject ErrorData;

		public RPCException (string code, string msg, JObject data = null) : base (msg)
		{
			ErrorCode = code;
			ErrorMessage = msg;
			ErrorData = data;
		}

		public RPCException (string code, string msg, RPCException orig, JObject data = null)
		{
			ErrorCode = code;
			ErrorMessage = msg + ": " + orig.ErrorMessage;
			ErrorData = data ?? new JObject ();
			ErrorData ["orig"] = orig.AsHeader ();
		}

		public RPCException (JObject header)
		{
			ErrorCode = header ["error_code"].AsString ("general");
			ErrorMessage = header ["error"].AsString ("Unknown error");
			ErrorData = header["error_data"] as JObject;
		}

		public RPCException (string code, string fmt, params object[] data)
		{
			ErrorCode = code;
			ErrorMessage = string.Format (fmt, data);
		}

		public static RPCException Wrap (Exception ex)
		{
			RPCException exx = ex as RPCException;
			if (exx != null) {
				return exx; // no wrapping needed
			} else {
				return new RPCException ("general", ex.ToString ());
			}
		}

		public JObject AsHeader ()
		{
			return new JObject {
				{ "error_code", ErrorCode },
				{ "error", ErrorMessage },
				{ "error_data", ErrorData },
			};
		}

		public static JObject DispatchFailure ()
		{
			return new JObject { { "dispatch_failure", true } };
		}

		public override string Message {
			get {
				return JSON.Stringify (new JArray { ErrorCode, ErrorMessage, ErrorData });
			}
		}
	}
}

