using System;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.IO;
using System.IO.Compression;
using System.Net;

namespace SCAMPUtil
{
	public static class CryptoUtils
	{
		public static string Fingerprint (X509Certificate2 cert)
		{
			return Regex.Replace (cert.Thumbprint, "..(?!$)", "$&:");
		}

		public static string ToBase64URL (byte[] data)
		{
			char[] tch = new char[ 4 * ((data.Length + 2) / 3) ];
			int chlen = Convert.ToBase64CharArray (data, 0, data.Length, tch, 0);
			for (int i = 0; i < chlen; i++) {
				if (tch [i] == '+')
					tch [i] = '-';
				if (tch [i] == '/')
					tch [i] = '_';
				if (tch [i] == '=') {
					chlen = i;
					break;
				}
			}
			return new string (tch, 0, chlen);
		}

		public static byte[] FromBase64URL (string text)
		{
			char[] tch = new char[text.Length + 4];
			text.CopyTo (0, tch, 0, text.Length);
			int i = 0;
			while (i < text.Length) {
				if (tch [i] == '-')
					tch [i] = '+';
				if (tch [i] == '_')
					tch [i] = '/';
				i++;
			}
			while ((i & 3) != 0)
				tch [i++] = '=';
			return Convert.FromBase64CharArray (tch, 0, i);
		}

		static byte[] RemoveSlopByte (byte[] bitstr)
		{
			byte[] r = new byte[bitstr.Length - 1];
			Array.Copy (bitstr, 1, r, 0, r.Length);
			return r;
		}

		public static RSACryptoServiceProvider ParseX509PublicKey (string pem)
		{
			ASN1 root = new ASN1 (StripPEM (pem));
			ASN1 proot = new ASN1 (RemoveSlopByte (root [1].Value));
			RSAParameters rsa = default(RSAParameters);
			rsa.Modulus = proot [0].Value;
			rsa.Exponent = proot [1].Value;
			RSACryptoServiceProvider cp = new RSACryptoServiceProvider ();
			cp.ImportParameters (rsa);
			return cp;
		}

		public static RSACryptoServiceProvider ParseX509PrivateKey (string pem)
		{
			ASN1 root = new ASN1 (StripPEM (pem));
			ASN1 matl = new ASN1 (root [2].Value);
			RSAParameters rsa = default (RSAParameters);
			rsa.Modulus = matl [1].Value;
			rsa.Exponent = matl [2].Value;
			rsa.D = matl [3].Value;
			rsa.P = matl [4].Value;
			rsa.Q = matl [5].Value;
			rsa.DP = matl [6].Value;
			rsa.DQ = matl [7].Value;
			rsa.InverseQ = matl [8].Value;
			RSACryptoServiceProvider cp = new RSACryptoServiceProvider ();
			cp.ImportParameters (rsa);
			return cp;
		}

		public static X509Certificate2 LoadKeyPair (string certFile, string keyFile)
		{
			var key = File.ReadAllText (keyFile);
			var cert = File.ReadAllText (certFile);

			var x509 = new X509Certificate2 (StripPEM (cert));
			x509.PrivateKey = ParseX509PrivateKey (key);
			return x509;
		}

		public static string CertificateToPEM (X509Certificate2 cert)
		{
			return Base64Folded ("CERTIFICATE", cert.RawData, 64);
		}

		public static byte[] StripPEM (string pem)
		{
			return Convert.FromBase64String (Regex.Replace (pem, @"-----.*\n?", ""));
		}

		public static X509Certificate2 PEMToCertificate (string pem)
		{
			return new X509Certificate2 (StripPEM (pem));
		}

		public static string RandomBase64 (int len)
		{
			byte[] t = new byte[(3 * len + 3) / 4];
			using (var rng = RandomNumberGenerator.Create ())
				rng.GetBytes (t);

			return Convert.ToBase64String (t).Substring (0, len);
		}

		public static string Base64Folded (string what, byte[] data, int linelen)
		{
			StringBuilder sb = new StringBuilder ();
			string b64 = Convert.ToBase64String (data);

			if (what != null)
				sb.AppendFormat ("-----BEGIN {0}-----\n", what);
			for (int i = 0; i < b64.Length;) {
				int ll = Math.Min (linelen, b64.Length - i);
				sb.Append (b64.Substring (i, ll));
				sb.Append ('\n');
				i += ll;
			}
			if (what != null)
				sb.AppendFormat ("-----END {0}-----\n", what);
			return sb.ToString ();
		}

		public static byte[] ZlibCompress (byte[] unc)
		{
			var buf = new MemoryStream ();
			buf.Write (new byte[] { 0x78, 0x9c }, 0, 2); // zlib header, DEFLATE w/ 32kb block size, default compression, no preset dictionary
			using (var comp = new DeflateStream (buf, CompressionMode.Compress, true)) {
				comp.Write (unc, 0, unc.Length);
			}
			buf.Write (BitConverter.GetBytes (IPAddress.HostToNetworkOrder ((int)Adler32 (unc))), 0, 4);

			return buf.ToArray ();
		}

		public static uint Adler32 (byte[] unc)
		{
			ulong s1 = 1, s2 = 0;
			foreach (var byt in unc) {
				s1 += byt;
				s2 += s1;
			}
			return (uint)(((s2 % 65521) << 16) + (s1 % 65521));
		}
	}
}

