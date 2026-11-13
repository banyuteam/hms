package filestore

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestSniffRefusesEmbeddedObjectsAndExternalTemplates(t *testing.T) {
	rels := func(rel string) []byte {
		return zipOf(t, map[string]string{"[Content_Types].xml": docxTypes, "word/document.xml": "x",
			"word/_rels/settings.xml.rels": `<Relationships>` + rel + `</Relationships>`})
	}
	for name, b := range map[string][]byte{
		"embedded ole": zipOf(t, map[string]string{"[Content_Types].xml": docxTypes, "word/document.xml": "x",
			"word/embeddings/oleObject1.bin": "MZ"}),
		"remote template": rels(`<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://evil.example/t.dotm" TargetMode="External"/>`),
		"mode first":      rels(`<Relationship TargetMode="External" Id="r1" Target="\\evil\x" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject"/>`),
	} {
		_, err := Sniff(b)
		rejected(t, err, RejectActiveContent)
		if t.Failed() {
			t.Fatalf("case %s", name)
		}
	}
	link := rels(`<Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://kemkes.go.id" TargetMode="External"/>`)
	if got, err := Sniff(link); err != nil || got != TypeDOCX {
		t.Errorf("an external hyperlink is allowed: %q %v", got, err)
	}
}

type fakeScanner struct {
	clean bool
	err   error
	seen  []byte
}

func (f *fakeScanner) Scan(_ context.Context, b []byte) (bool, string, error) {
	f.seen = b
	return f.clean, "Fake 1/1", f.err
}

var clinical = Policy{Allowed: []string{TypePDF, TypeJPEG, TypePNG}, MaxBytes: 10 << 20, MaxPDFPages: 5}

func TestAccept(t *testing.T) {
	ctx := context.Background()
	s := &fakeScanner{clean: true}
	a, err := Accept(ctx, clinical, s, pdfOf(2, ""))
	if err != nil || a.MediaType != TypePDF || a.PageCount != 2 || a.ScanEngine != "Fake 1/1" ||
		a.SHA256 != sha256.Sum256(a.Data) || a.ScannedAt.IsZero() {
		t.Fatalf("pdf: %+v %v", a, err)
	}

	in := jpegWithExif(t)
	a, err = Accept(ctx, clinical, s, in)
	if err != nil || a.MediaType != TypeJPEG || bytes.Contains(a.Data, []byte("GPS-LAT")) || a.PageCount != 0 {
		t.Fatalf("jpeg stored re-encoded: %v", err)
	}
	if !bytes.Equal(s.seen, in) {
		t.Error("the scanner must see the file as uploaded")
	}
	if a.SHA256 != sha256.Sum256(a.Data) {
		t.Error("hash is of the stored bytes")
	}

	for name, tc := range map[string]struct {
		p    Policy
		s    Scanner
		b    []byte
		code string
	}{
		"empty":           {clinical, s, nil, RejectUnreadable},
		"too large":       {Policy{Allowed: clinical.Allowed, MaxBytes: 100}, s, pdfOf(1, ""), RejectTooLarge},
		"not allowed":     {clinical, s, docx(t), RejectUnsupported},
		"too many pages":  {clinical, s, pdfOf(6, ""), RejectTooManyPages},
		"active content":  {clinical, s, pdfOf(1, "/OpenAction << /S /JavaScript /JS (x) >>"), RejectActiveContent},
		"malware":         {clinical, &fakeScanner{clean: false}, pdfOf(1, ""), RejectMalware},
		"unknown content": {clinical, s, []byte("MZ\x90\x00"), RejectUnsupported},
	} {
		_, err := Accept(ctx, tc.p, tc.s, tc.b)
		rejected(t, err, tc.code)
		if t.Failed() {
			t.Fatalf("case %s", name)
		}
	}
	office := Policy{Allowed: []string{TypeDOCX, TypeXLSX, TypePDF}, MaxBytes: 20 << 20}
	if a, err := Accept(ctx, office, s, docx(t)); err != nil || a.MediaType != TypeDOCX {
		t.Errorf("docx allowed by policy: %v", err)
	}
	if _, err := Accept(ctx, clinical, &fakeScanner{err: ErrScannerUnavailable}, pdfOf(1, "")); !errors.Is(err, ErrScannerUnavailable) {
		t.Errorf("scanner down: %v (fail closed)", err)
	}
}

func TestNewIDIsUUIDv7(t *testing.T) {
	v7 := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	a := NewID()
	time.Sleep(2 * time.Millisecond)
	b := NewID()
	if !v7.MatchString(a) || !v7.MatchString(b) || !(a < b) {
		t.Errorf("ids %s %s", a, b)
	}
}

func TestVolume(t *testing.T) {
	dir := t.TempDir()
	v, err := NewVolume(dir, "documents")
	if err != nil {
		t.Fatal(err)
	}
	id := NewID()
	data := []byte("%PDF-1.7 test")
	key, err := v.Save(time.Date(2026, 11, 11, 23, 0, 0, 0, time.FixedZone("WIB", 7*3600)), id, data)
	if err != nil || key != "documents/2026/11/"+id {
		t.Fatalf("key %q %v", key, err)
	}
	sum := sha256.Sum256(data)
	if got, err := v.Read(key, sum[:]); err != nil || !bytes.Equal(got, data) {
		t.Fatalf("read: %v", err)
	}
	if _, err := v.Save(time.Now(), id, data); err == nil {
		t.Error("an existing key is never overwritten")
	}
	if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(key)), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Read(key, sum[:]); !errors.Is(err, ErrIntegrity) {
		t.Errorf("tampered file: %v", err)
	}
	for _, bad := range []string{"../etc/passwd", "catalogue/2026/11/" + id, "documents/2026/11/" + id + "/..", "documents/x"} {
		if _, err := v.Read(bad, sum[:]); !errors.Is(err, ErrBadKey) {
			t.Errorf("key %q: %v", bad, err)
		}
	}
	if _, err := v.Save(time.Now(), "../../x", data); !errors.Is(err, ErrBadKey) {
		t.Errorf("id must be a UUID: %v", err)
	}
	if _, err := v.Read("documents/2026/11/"+NewID(), sum[:]); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing: %v", err)
	}
	if err := v.Remove(key); err != nil || v.Remove(key) != nil {
		t.Errorf("remove is idempotent: %v", err)
	}
	if _, err := NewVolume(dir, "Bad/NS"); err == nil {
		t.Error("namespace must be lower-case")
	}
}

func multipartRequest(t *testing.T, fields map[string]string, files map[string][]byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	for k, b := range files {
		w, _ := mw.CreateFormFile(k, "Pasien_Budi_NIK3374.pdf")
		_, _ = w.Write(b)
	}
	mw.Close()
	r := httptest.NewRequest(http.MethodPost, "/upload", &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestReadMultipart(t *testing.T) {
	u, err := ReadMultipart(httptest.NewRecorder(), multipartRequest(t,
		map[string]string{"title": "Hasil lab", "category": "external-lab-result"}, map[string][]byte{"file": []byte("%PDF")}), "file", 1024)
	if err != nil || string(u.File) != "%PDF" || u.Fields["title"] != "Hasil lab" || len(u.Fields) != 2 {
		t.Fatalf("%+v %v", u, err)
	}
	for name, tc := range map[string]struct {
		r    *http.Request
		code string
	}{
		"no file":      {multipartRequest(t, map[string]string{"title": "x"}, nil), RejectInvalidUpload},
		"two files":    {multipartRequest(t, nil, map[string][]byte{"file": []byte("a"), "other": []byte("b")}), RejectInvalidUpload},
		"file too big": {multipartRequest(t, nil, map[string][]byte{"file": bytes.Repeat([]byte("a"), 2048)}), RejectTooLarge},
		"long field":   {multipartRequest(t, map[string]string{"title": strings.Repeat("x", 5000)}, map[string][]byte{"file": []byte("a")}), RejectInvalidUpload},
		"json body": {func() *http.Request {
			r := httptest.NewRequest(http.MethodPost, "/u", strings.NewReader("{}"))
			r.Header.Set("Content-Type", "application/json")
			return r
		}(), RejectInvalidUpload},
	} {
		_, err := ReadMultipart(httptest.NewRecorder(), tc.r, "file", 1024)
		rejected(t, err, tc.code)
		if t.Failed() {
			t.Fatalf("case %s", name)
		}
	}
}

// fakeClamd speaks clamd's zPING, zVERSION and zINSTREAM. A stream containing "EICAR" is reported infected.
func fakeClamd(t *testing.T) string {
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
				case "zPING\x00":
					c.Write([]byte("PONG\x00"))
				case "zVERSION\x00":
					c.Write([]byte("ClamAV 1.4.3/27800/Tue Nov 11 09:00:00 2026\x00"))
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
					if bytes.Contains(stream, []byte("EICAR")) {
						c.Write([]byte("stream: Eicar-Test-Signature FOUND\x00"))
					} else {
						c.Write([]byte("stream: OK\x00"))
					}
				}
			}(conn)
		}
	}()
	return ln.Addr().String()
}

func TestClamAV(t *testing.T) {
	c := &ClamAV{Addr: fakeClamd(t), Timeout: 5 * time.Second}
	ctx := context.Background()
	if err := c.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	clean, engine, err := c.Scan(ctx, bytes.Repeat([]byte("a"), 3*clamChunk+17))
	if err != nil || !clean || engine != "ClamAV 1.4.3/27800" {
		t.Fatalf("clean: %v %q %v", clean, engine, err)
	}
	if clean, _, err := c.Scan(ctx, []byte("X5O!P%@AP EICAR test")); err != nil || clean {
		t.Errorf("infected: %v %v", clean, err)
	}
	down := &ClamAV{Addr: "127.0.0.1:1", Timeout: time.Second}
	if _, _, err := down.Scan(ctx, []byte("x")); !errors.Is(err, ErrScannerUnavailable) {
		t.Errorf("down: %v", err)
	}
	if err := down.Ping(ctx); !errors.Is(err, ErrScannerUnavailable) {
		t.Errorf("ping down: %v", err)
	}
}
