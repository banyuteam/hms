package main

import "testing"

func TestHealthURL(t *testing.T) {
	cases := map[string]string{
		"":               "http://127.0.0.1:8080/healthz",
		":8080":          "http://127.0.0.1:8080/healthz",
		"0.0.0.0:9000":   "http://127.0.0.1:9000/healthz",
		"[::]:8080":      "http://127.0.0.1:8080/healthz",
		"127.0.0.1:8080": "http://127.0.0.1:8080/healthz",
		"10.1.2.3:8081":  "http://10.1.2.3:8081/healthz",
		"[::1]:8080":     "http://[::1]:8080/healthz",
	}
	for addr, want := range cases {
		got, err := healthURL(addr)
		if err != nil || got != want {
			t.Errorf("healthURL(%q) = %q, %v; want %q", addr, got, err, want)
		}
	}
	for _, bad := range []string{"8080", "localhost", "host:"} {
		if _, err := healthURL(bad); err == nil {
			t.Errorf("healthURL(%q) should fail", bad)
		}
	}
}
