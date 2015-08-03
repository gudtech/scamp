package scamp

import "encoding/hex"
import "strings"

import "crypto/sha1"
import "crypto/x509"

func sha1FingerPrint(cert *x509.Certificate) (hexSha1 string) {
	h := sha1.New()
	h.Write(cert.Raw)
	val := h.Sum(nil)
	rawHexEncoded := hex.EncodeToString(val)
	upperCased := strings.ToUpper(rawHexEncoded)
	upperCasedLen := len(upperCased)
	hexSha1 = ""

	for i, rune := range upperCased {
		hexSha1 = hexSha1 + string(rune)
		if i > 0 && i != upperCasedLen-1 && (i+1)%2 == 0 {
			hexSha1 = hexSha1 + ":"
		}
	}

	return
}
