// Package filestore takes files uploaded from outside HMS and keeps them on the file volume (ADR-SVC-013; used by
// document attachments and by the catalogue, ADR-SVC-012). It decides the type from the content (never the file name
// or the browser's claim), applies the checks of that type, scans with ClamAV (fail closed), and stores the bytes under
// keys it generates, "<namespace>/yyyy/mm/<id>". The database keeps only the key, the type, the size and the SHA-256;
// every read verifies the hash. A file name is never read or stored here.
package filestore

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"slices"
	"time"
)

// Media types filestore recognises. A feature allows a subset (Policy.Allowed).
const (
	TypePDF  = "application/pdf"
	TypeJPEG = "image/jpeg"
	TypePNG  = "image/png"
	TypeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	TypeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

// Hard limits, whatever a feature asks for. The databases enforce the file size again.
const (
	MaxFileBytes       = 20 << 20
	DefaultMaxPDFPages = 200
	MaxImagePixels     = 40_000_000
	MaxImageSide       = 12_000
)

// Rejection is why a file is refused. Code is part of the features' API contracts and audit details; it never carries
// file content or a file name.
type Rejection struct{ Code string }

func (r *Rejection) Error() string { return "file rejected: " + r.Code }

func reject(code string) error { return &Rejection{Code: code} }

// Rejection codes.
const (
	RejectUnsupported   = "unsupported_type"
	RejectLegacyOffice  = "legacy_office"
	RejectMacro         = "macro_document"
	RejectActiveContent = "active_content"
	RejectUnreadable    = "unreadable_file"
	RejectTooLarge      = "too_large"
	RejectTooManyPages  = "too_many_pages"
	RejectEncrypted     = "encrypted_pdf"
	RejectImageTooLarge = "image_too_large"
	RejectMalware       = "malware_found"
	RejectInvalidUpload = "invalid_upload"
)

// Policy is what one feature accepts.
type Policy struct {
	Allowed     []string // media types, e.g. {TypePDF, TypeJPEG, TypePNG}
	MaxBytes    int      // per file, as uploaded and as stored; at most MaxFileBytes
	MaxPDFPages int      // 0 = DefaultMaxPDFPages
}

// Scanner is a malware scanner; ClamAV in production, a fake in tests.
type Scanner interface {
	// Scan reports whether b is clean and the engine and signature version that decided it.
	Scan(ctx context.Context, b []byte) (clean bool, engine string, err error)
}

// Accepted is a file that passed every check, ready to be stored.
type Accepted struct {
	MediaType  string
	Data       []byte // what to store: images re-encoded (metadata removed), other types as uploaded
	PageCount  int    // PDF only, else 0
	SHA256     [32]byte
	ScanEngine string
	ScannedAt  time.Time
}

// Accept checks an uploaded file against the policy and scans it. A refusal is a *Rejection; a scanner that cannot
// answer is ErrScannerUnavailable (the file is refused too).
func Accept(ctx context.Context, p Policy, s Scanner, b []byte) (Accepted, error) {
	limit := p.MaxBytes
	if limit <= 0 || limit > MaxFileBytes {
		limit = MaxFileBytes
	}
	switch {
	case len(b) == 0:
		return Accepted{}, reject(RejectUnreadable)
	case len(b) > limit:
		return Accepted{}, reject(RejectTooLarge)
	}
	mediaType, err := Sniff(b)
	if err != nil {
		return Accepted{}, err
	}
	if !slices.Contains(p.Allowed, mediaType) {
		return Accepted{}, reject(RejectUnsupported)
	}
	a := Accepted{MediaType: mediaType, Data: b}
	switch mediaType {
	case TypePDF:
		maxPages := p.MaxPDFPages
		if maxPages <= 0 {
			maxPages = DefaultMaxPDFPages
		}
		if a.PageCount, err = CheckPDF(b, maxPages); err != nil {
			return Accepted{}, err
		}
	case TypeJPEG, TypePNG:
		if a.Data, err = ReencodeImage(b, mediaType, limit); err != nil {
			return Accepted{}, err
		}
	}
	// The file as uploaded is scanned: what the uploader sent is what is judged and audited.
	clean, engine, err := s.Scan(ctx, b)
	if err != nil {
		return Accepted{}, err
	}
	if !clean {
		return Accepted{}, reject(RejectMalware)
	}
	a.ScanEngine, a.ScannedAt, a.SHA256 = engine, time.Now(), sha256.Sum256(a.Data)
	return a, nil
}

// NewID returns a UUID version 7 (time ordered, like the databases' uuidv7()), lower case. A feature uses it as the
// file's database id and its storage key, so the key is known before the row is written.
func NewID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	ms := uint64(time.Now().UnixMilli())
	var ts [8]byte
	binary.BigEndian.PutUint64(ts[:], ms)
	copy(b[0:6], ts[2:8])
	b[6] = b[6]&0x0f | 0x70
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
