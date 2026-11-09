package documents

import (
	"bytes"
	"compress/zlib"
	"io"
	"regexp"
	"strconv"
)

// PDFInfo is what the checks need to know about a PDF: its page count and whether it is encrypted or carries active
// content. It is a bounded scan, not a full parser: the file is never rendered or executed here.
type PDFInfo struct {
	Pages     int
	Encrypted bool
	Active    bool
}

const (
	maxStreamInflate = 16 << 20 // per object stream
	maxTotalInflate  = 64 << 20 // per file
)

var (
	// Object streams hide dictionaries (pages, actions) inside compressed data; they are inflated and scanned too.
	objStream    = regexp.MustCompile(`(?s)<<(.{0,1000}?)>>\s*stream\r?\n`)
	nameEscape   = regexp.MustCompile(`#([0-9A-Fa-f]{2})`)
	pagesNode    = regexp.MustCompile(`/Type\s*/Pages\b`)
	countEntry   = regexp.MustCompile(`/Count\s+(\d{1,6})`)
	pageLeaf     = regexp.MustCompile(`/Type\s*/Page(?:[^A-Za-z]|$)`)
	encryptEntry = regexp.MustCompile(`/Encrypt[\s/<0-9]`)
	activeEntry  = regexp.MustCompile(`/(?:JavaScript|JS[\s(<\[/]|Launch|EmbeddedFile|RichMedia)`)
)

// InspectPDF checks the structure markers and counts pages.
func InspectPDF(b []byte) (PDFInfo, error) {
	if !bytes.HasPrefix(b, []byte("%PDF-")) {
		return PDFInfo{}, reject(RejectUnreadable)
	}
	tail := b
	if len(tail) > 2048 {
		tail = tail[len(tail)-2048:]
	}
	if !bytes.Contains(tail, []byte("%%EOF")) {
		return PDFInfo{}, reject(RejectUnreadable)
	}

	texts := [][]byte{b}
	budget := maxTotalInflate
	for _, m := range objStream.FindAllSubmatchIndex(b, -1) {
		dict := b[m[2]:m[3]]
		if !bytes.Contains(dict, []byte("/ObjStm")) || !bytes.Contains(dict, []byte("/FlateDecode")) || budget <= 0 {
			continue
		}
		end := bytes.Index(b[m[1]:], []byte("endstream"))
		if end < 0 {
			continue
		}
		data, ok := inflate(b[m[1]:m[1]+end], min(budget, maxStreamInflate))
		if ok {
			budget -= len(data)
			texts = append(texts, data)
		}
	}

	var info PDFInfo
	leaves := 0
	for _, t := range texts {
		// Names may be written with #xx escapes (/Java#53cript); decode them before matching.
		t = nameEscape.ReplaceAllFunc(t, func(h []byte) []byte {
			n, _ := strconv.ParseUint(string(h[1:]), 16, 8)
			return []byte{byte(n)}
		})
		info.Encrypted = info.Encrypted || encryptEntry.Match(t)
		info.Active = info.Active || activeEntry.Match(t)
		leaves += len(pageLeaf.FindAllIndex(t, -1))
		// The page tree's root /Pages node has the largest /Count: the number of pages.
		for _, p := range pagesNode.FindAllIndex(t, -1) {
			lo, hi := max(0, p[0]-512), min(len(t), p[1]+512)
			for _, c := range countEntry.FindAllSubmatch(t[lo:hi], -1) {
				if n, err := strconv.Atoi(string(c[1])); err == nil && n > info.Pages {
					info.Pages = n
				}
			}
		}
	}
	if info.Pages == 0 {
		info.Pages = leaves
	}
	if info.Pages == 0 {
		return PDFInfo{}, reject(RejectUnreadable)
	}
	return info, nil
}

// inflate decompresses up to limit bytes; ok=false if the data is not zlib or is larger than the limit.
func inflate(data []byte, limit int) ([]byte, bool) {
	zr, err := zlib.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, false
	}
	defer zr.Close()
	out, err := io.ReadAll(io.LimitReader(zr, int64(limit)+1))
	if (err != nil && err != io.ErrUnexpectedEOF) || len(out) > limit {
		return nil, false
	}
	return out, true
}

// CheckPDF applies the PDF rules of D-9: readable, not encrypted, no active content, 1 to 50 pages.
func CheckPDF(b []byte) (int, error) {
	info, err := InspectPDF(b)
	switch {
	case err != nil:
		return 0, err
	case info.Encrypted:
		return 0, reject(RejectEncrypted)
	case info.Active:
		return 0, reject(RejectActiveContent)
	case info.Pages > MaxPDFPages:
		return 0, reject(RejectTooManyPages)
	}
	return info.Pages, nil
}
