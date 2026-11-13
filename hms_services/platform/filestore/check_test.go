package filestore

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

// Synthetic test files, built in memory.

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

const docxTypes = `<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`

func docx(t *testing.T) []byte {
	return zipOf(t, map[string]string{"[Content_Types].xml": docxTypes, "word/document.xml": "<w:document/>"})
}

// pdfOf builds a minimal PDF with n pages and extra text in the catalog.
func pdfOf(n int, extra string) []byte {
	var b strings.Builder
	b.WriteString("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R " + extra + " >> endobj\n")
	kids := make([]string, n)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", i+3)
	}
	fmt.Fprintf(&b, "2 0 obj << /Type /Pages /Kids [%s] /Count %d >> endobj\n", strings.Join(kids, " "), n)
	for i := 0; i < n; i++ {
		fmt.Fprintf(&b, "%d 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n", i+3)
	}
	b.WriteString("trailer << /Root 1 0 R >>\n%%EOF\n")
	return []byte(b.String())
}

// pdfWithObjStm hides its page tree (and anything in hidden) inside a compressed object stream, as modern PDFs do.
func pdfWithObjStm(t *testing.T, pages int, hidden string) []byte {
	t.Helper()
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	fmt.Fprintf(zw, "2 0 << /Type /Pages /Kids [] /Count %d >> %s", pages, hidden)
	zw.Close()
	var b bytes.Buffer
	b.WriteString("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
	fmt.Fprintf(&b, "5 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length %d >>\nstream\n", z.Len())
	b.Write(z.Bytes())
	b.WriteString("\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")
	return b.Bytes()
}

func jpegWithExif(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 16, 16))
	for x := 0; x < 16; x++ {
		img.Set(x, x, color.RGBA{200, 10, 10, 255})
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	payload := []byte("Exif\x00\x00GPS-LAT-6.9932-LON-110.4203")
	app1 := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(app1[2:], uint16(len(payload)+2))
	b := buf.Bytes()
	return append(append(append([]byte{}, b[:2]...), append(app1, payload...)...), b[2:]...)
}

// pngHeader is a PNG whose header claims w×h pixels (no image data: only the size check reads it).
func pngHeader(w, h uint32) []byte {
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 2
	chunk := append([]byte("IHDR"), ihdr...)
	var out bytes.Buffer
	out.WriteString("\x89PNG\r\n\x1a\n")
	_ = binary.Write(&out, binary.BigEndian, uint32(13))
	out.Write(chunk)
	_ = binary.Write(&out, binary.BigEndian, crc32.ChecksumIEEE(chunk))
	return out.Bytes()
}

func rejected(t *testing.T, err error, code string) {
	t.Helper()
	var r *Rejection
	if !errors.As(err, &r) || r.Code != code {
		t.Errorf("want rejection %s, got %v", code, err)
	}
}

func TestSniffTakesTheTypeFromTheContent(t *testing.T) {
	var png bytes.Buffer
	_ = png.WriteByte(0)
	for name, tc := range map[string]struct {
		b    []byte
		want string
	}{
		"jpeg": {jpegWithExif(t), TypeJPEG},
		"png":  {pngHeader(10, 10), TypePNG},
		"pdf":  {pdfOf(1, ""), TypePDF},
		"docx": {docx(t), TypeDOCX},
		"xlsx": {zipOf(t, map[string]string{"[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>"}), TypeXLSX},
	} {
		if got, err := Sniff(tc.b); err != nil || got != tc.want {
			t.Errorf("%s: %q %v", name, got, err)
		}
	}
	for name, tc := range map[string]struct {
		b    []byte
		code string
	}{
		"text":          {[]byte("hello"), RejectUnsupported},
		"exe":           {[]byte("MZ\x90\x00"), RejectUnsupported},
		"legacy office": {[]byte("\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1rest"), RejectLegacyOffice},
		"macro part": {zipOf(t, map[string]string{"[Content_Types].xml": docxTypes, "word/document.xml": "x",
			"word/vbaProject.bin": "x"}), RejectMacro},
		"renamed docm": {zipOf(t, map[string]string{"[Content_Types].xml": `<Types><Override ContentType=` +
			`"application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>`, "word/document.xml": "x"}), RejectMacro},
		"activex": {zipOf(t, map[string]string{"[Content_Types].xml": docxTypes, "word/document.xml": "x",
			"word/activeX/activeX1.xml": "x"}), RejectActiveContent},
		"pptx":       {zipOf(t, map[string]string{"[Content_Types].xml": "<Types/>", "ppt/presentation.xml": "x"}), RejectUnsupported},
		"plain zip":  {zipOf(t, map[string]string{"a.txt": "x"}), RejectUnsupported},
		"broken zip": {[]byte("PK\x03\x04garbage"), RejectUnreadable},
	} {
		_, err := Sniff(tc.b)
		rejected(t, err, tc.code)
		if t.Failed() {
			t.Logf("case %s", name)
		}
	}
}

func TestSniffRefusesArchivesThatUnpackTooLarge(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range []string{"[Content_Types].xml", "word/document.xml"} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte("x"))
	}
	// A header that claims 200 MiB unpacked (a zip bomb's tell).
	w, _ := zw.CreateRaw(&zip.FileHeader{Name: "word/media/big.bin", Method: zip.Store, CompressedSize64: 1,
		UncompressedSize64: 200 << 20})
	_, _ = w.Write([]byte("x"))
	zw.Close()
	_, err := Sniff(buf.Bytes())
	rejected(t, err, RejectTooLarge)
}

func TestPDFChecks(t *testing.T) {
	if pages, err := CheckPDF(pdfOf(3, ""), 50); err != nil || pages != 3 {
		t.Errorf("3 pages: %d %v", pages, err)
	}
	if pages, err := CheckPDF(pdfWithObjStm(t, 7, ""), 50); err != nil || pages != 7 {
		t.Errorf("pages inside an object stream: %d %v", pages, err)
	}
	for name, tc := range map[string]struct {
		b    []byte
		code string
	}{
		"51 pages":          {pdfOf(51, ""), RejectTooManyPages},
		"javascript":        {pdfOf(1, "/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), RejectActiveContent},
		"escaped name":      {pdfOf(1, "/OpenAction << /S /Java#53cript /JS (x) >>"), RejectActiveContent},
		"launch":            {pdfOf(1, "/OpenAction << /S /Launch /F (cmd.exe) >>"), RejectActiveContent},
		"embedded file":     {pdfOf(1, "/Names << /EmbeddedFiles << >> >>"), RejectActiveContent},
		"hidden javascript": {pdfWithObjStm(t, 1, "<< /S /JavaScript /JS (app.alert(1)) >>"), RejectActiveContent},
		"encrypted":         {bytes.Replace(pdfOf(1, ""), []byte("trailer << /Root 1 0 R"), []byte("trailer << /Root 1 0 R /Encrypt 9 0 R"), 1), RejectEncrypted},
		"truncated":         {pdfOf(1, "")[:60], RejectUnreadable},
		"no pages":          {[]byte("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n"), RejectUnreadable},
		"not a pdf":         {[]byte("hello %%EOF"), RejectUnreadable},
	} {
		_, err := CheckPDF(tc.b, 50)
		rejected(t, err, tc.code)
		if t.Failed() {
			t.Logf("case %s", name)
		}
	}
}

func TestImagesAreReencodedWithoutMetadata(t *testing.T) {
	in := jpegWithExif(t)
	if !bytes.Contains(in, []byte("GPS-LAT")) {
		t.Fatal("fixture has no EXIF")
	}
	out, err := ReencodeImage(in, TypeJPEG, MaxFileBytes)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out, []byte("Exif")) || bytes.Contains(out, []byte("GPS-LAT")) {
		t.Error("metadata survived the re-encode")
	}
	if _, err := jpeg.Decode(bytes.NewReader(out)); err != nil {
		t.Errorf("output is not a JPEG: %v", err)
	}

	var p bytes.Buffer
	_ = png.Encode(&p, image.NewGray(image.Rect(0, 0, 8, 8)))
	if out, err := ReencodeImage(p.Bytes(), TypePNG, MaxFileBytes); err != nil || !bytes.HasPrefix(out, []byte("\x89PNG")) {
		t.Errorf("png: %v", err)
	}

	_, err = ReencodeImage(pngHeader(50_000, 50_000), TypePNG, MaxFileBytes)
	rejected(t, err, RejectImageTooLarge)
	_, err = ReencodeImage(pngHeader(8_000, 8_000), TypePNG, MaxFileBytes) // 64 MP
	rejected(t, err, RejectImageTooLarge)
	_, err = ReencodeImage([]byte{0xFF, 0xD8, 0xFF, 0x00, 0x01}, TypeJPEG, MaxFileBytes)
	rejected(t, err, RejectUnreadable)
}
