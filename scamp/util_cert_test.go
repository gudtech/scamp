package scamp

import "testing"
import "crypto/x509"
import "encoding/pem"

func TestSHA1Fingerprint(t *testing.T) {
	cert_bytes := []byte(`-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----`)
	block, _ := pem.Decode(cert_bytes)
	if block == nil && block.Type != "CERTIFICATE" {
		t.Errorf("expected to block to be non-nil CERTIFICATE", block)
		t.FailNow()
	}

	var cert *x509.Certificate
	cert, err := x509.ParseCertificate(block.Bytes)

	if err != nil {
		t.Errorf("error parsing cert (what)")
		t.FailNow()
	}

	expected_fingerprint := "3B:1C:53:11:78:8B:70:71:07:00:FE:29:2F:AA:22:82:57:26:4A:09"
	if SHA1FingerPrint(cert) != expected_fingerprint {
		t.Errorf("cert fingerprints did not match")
		t.FailNow()
	}
}
