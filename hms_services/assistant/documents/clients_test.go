package documents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// fakeClamd speaks clamd's zVERSION and zINSTREAM. A stream containing "EICAR" is reported infected.
func fakeClamd(t *testing.T, reply func(stream []byte) string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				r := bufio.NewReader(c)
				cmd, err := r.ReadString(0)
				if err != nil {
					return
				}
				switch cmd {
				case "zVERSION\x00":
					c.Write([]byte("ClamAV 1.4.2/27450/Sun Nov  9 09:00:00 2026\x00"))
				case "zINSTREAM\x00":
					var stream []byte
					for {
						var size uint32
						if binary.Read(r, binary.BigEndian, &size) != nil {
							return
						}
						if size == 0 {
							break
						}
						chunk := make([]byte, size)
						if _, err := io.ReadFull(r, chunk); err != nil {
							return
						}
						stream = append(stream, chunk...)
					}
					c.Write([]byte(reply(stream) + "\x00"))
				}
			}(conn)
		}
	}()
	return ln.Addr().String()
}

func eicar(stream []byte) string {
	if bytes.Contains(stream, []byte("EICAR")) {
		return "stream: Eicar-Test-Signature FOUND"
	}
	return "stream: OK"
}

func TestClamAVScansInChunks(t *testing.T) {
	var got []byte
	addr := fakeClamd(t, func(s []byte) string { got = s; return eicar(s) })
	c := &ClamAV{Addr: addr, Timeout: 5 * time.Second}
	big := bytes.Repeat([]byte("a"), 3*clamChunk+17)
	clean, engine, err := c.Scan(context.Background(), big)
	if err != nil || !clean || engine != "ClamAV 1.4.2/27450" {
		t.Fatalf("clean file: %v %q %v", clean, engine, err)
	}
	if !bytes.Equal(got, big) {
		t.Errorf("stream reassembled to %d bytes, want %d", len(got), len(big))
	}
	clean, _, err = c.Scan(context.Background(), []byte("X5O!P%@AP EICAR test"))
	if err != nil || clean {
		t.Errorf("infected file reported clean: %v", err)
	}
}

func TestClamAVFailuresRefuseTheFile(t *testing.T) {
	addr := fakeClamd(t, func([]byte) string { return "INSTREAM size limit exceeded. ERROR" })
	if _, _, err := (&ClamAV{Addr: addr}).Scan(context.Background(), []byte("x")); !errors.Is(err, ErrScannerUnavailable) {
		t.Errorf("error reply: %v", err)
	}
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	closed := ln.Addr().String()
	ln.Close()
	if _, _, err := (&ClamAV{Addr: closed}).Scan(context.Background(), []byte("x")); !errors.Is(err, ErrScannerUnavailable) {
		t.Errorf("scanner down: %v", err)
	}
}

func TestConverterSendsAFixedNameAndReturnsThePDF(t *testing.T) {
	var gotName, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		f, fh, err := r.FormFile("files")
		if err != nil {
			http.Error(w, "no file", http.StatusBadRequest)
			return
		}
		defer f.Close()
		gotName = fh.Filename
		if b, _ := io.ReadAll(f); string(b) == "broken" {
			http.Error(w, "cannot convert", http.StatusBadRequest)
			return
		}
		w.Write(pdfOf(2, ""))
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	c := NewConverter(u)
	pdf, err := c.ToPDF(context.Background(), []byte("docx bytes"), TypeDOCX)
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatalf("convert: %v", err)
	}
	if gotPath != "/forms/libreoffice/convert" || gotName != "document.docx" {
		t.Errorf("request %s %s", gotPath, gotName)
	}
	if _, err := c.ToPDF(context.Background(), []byte("x"), TypeXLSX); err != nil || gotName != "document.xlsx" {
		t.Errorf("xlsx: %s %v", gotName, err)
	}
	_, err = c.ToPDF(context.Background(), []byte("broken"), TypeDOCX)
	rejected(t, err, RejectUnreadable)
	srv.Close()
	if _, err := c.ToPDF(context.Background(), []byte("x"), TypeDOCX); !errors.Is(err, ErrConverterUnavailable) {
		t.Errorf("converter down: %v", err)
	}
}

func TestVolumeStoresUnderGeneratedKeysOnly(t *testing.T) {
	v := Volume{Dir: t.TempDir()}
	id := newID()
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id) {
		t.Fatalf("id %q", id)
	}
	key, err := v.Save(time.Date(2026, 11, 9, 23, 0, 0, 0, time.UTC), id, []byte("data"))
	if err != nil || key != "2026/11/"+id {
		t.Fatalf("save: %q %v", key, err)
	}
	b, err := os.ReadFile(filepath.Join(v.Dir, "2026", "11", id))
	if err != nil || string(b) != "data" {
		t.Fatalf("stored: %q %v", b, err)
	}
	entries, _ := os.ReadDir(filepath.Join(v.Dir, "2026", "11"))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".upload-") {
			t.Error("temporary file left behind")
		}
	}
	if err := v.Remove(key); err != nil {
		t.Fatal(err)
	}
	if err := v.Remove(key); err != nil {
		t.Errorf("removing a missing file is not an error: %v", err)
	}
	for _, bad := range []string{"../../etc/passwd", "2026/11/../x", "2026/11/" + strings.ToUpper(id), ""} {
		if err := v.Remove(bad); !errors.Is(err, ErrBadKey) {
			t.Errorf("key %q accepted", bad)
		}
	}
	if _, err := v.Save(time.Now(), "../escape", []byte("x")); !errors.Is(err, ErrBadKey) {
		t.Errorf("id outside the pattern accepted: %v", err)
	}
}
