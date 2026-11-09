// Package documents takes uploaded files for the assistant's document reading (ADR-SVC-009): it checks them (type from
// content, malware scan, Office conversion, PDF and image checks), stores them on the document volume and records their
// metadata. It never reads a file name, and nothing here calls an AI model.
package documents

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
)

// Media types: what may be uploaded (D-3/U-3) and what is stored (Office files as their PDF conversion).
const (
	TypeJPEG = "image/jpeg"
	TypePNG  = "image/png"
	TypePDF  = "application/pdf"
	TypeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	TypeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

// Limits (D-9). The database enforces the same file size and page count.
const (
	MaxFileBytes      = 10 << 20
	MaxPDFPages       = 50
	MaxImagePixels    = 20_000_000
	MaxImageSide      = 12_000
	maxZipEntries     = 2_000
	maxZipUnpacked    = 100 << 20
	maxContentTypesXM = 1 << 20
)

// Rejection is why a file is refused. Code is part of the API (assistant-v1) and the audit detail; it never carries
// file content or the file name.
type Rejection struct{ Code string }

func (r *Rejection) Error() string { return "document rejected: " + r.Code }

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
)

// Sniff returns the media type from the file's bytes (never from its name or the browser's claim).
func Sniff(b []byte) (string, error) {
	switch {
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return TypeJPEG, nil
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return TypePNG, nil
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return TypePDF, nil
	case bytes.HasPrefix(b, []byte("PK\x03\x04")):
		return sniffOOXML(b)
	case bytes.HasPrefix(b, []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}):
		// OLE2: legacy .doc/.xls (and their macro variants), refused (D-10).
		return "", reject(RejectLegacyOffice)
	}
	return "", reject(RejectUnsupported)
}

// sniffOOXML accepts a Word or Excel document without macros or ActiveX, within archive limits. The archive is not
// unpacked here (only [Content_Types].xml is read); the converter, which is isolated and limited, unpacks it.
func sniffOOXML(b []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return "", reject(RejectUnreadable)
	}
	if len(zr.File) > maxZipEntries {
		return "", reject(RejectTooLarge)
	}
	var unpacked uint64
	var hasTypes, word, excel bool
	for _, f := range zr.File {
		unpacked += f.UncompressedSize64
		name := strings.ToLower(f.Name)
		switch {
		case name == "[content_types].xml":
			hasTypes = true
		case name == "word/document.xml":
			word = true
		case name == "xl/workbook.xml":
			excel = true
		case strings.HasSuffix(name, "vbaproject.bin") || strings.HasSuffix(name, "vbadata.xml"):
			return "", reject(RejectMacro)
		case strings.Contains(name, "/activex/"):
			return "", reject(RejectActiveContent)
		}
	}
	if unpacked > maxZipUnpacked {
		return "", reject(RejectTooLarge)
	}
	if !hasTypes || word == excel {
		return "", reject(RejectUnsupported)
	}
	// Macro-enabled formats declare it in their content types even when renamed to .docx/.xlsx.
	for _, f := range zr.File {
		if strings.EqualFold(f.Name, "[Content_Types].xml") {
			rc, err := f.Open()
			if err != nil {
				return "", reject(RejectUnreadable)
			}
			data, err := io.ReadAll(io.LimitReader(rc, maxContentTypesXM))
			rc.Close()
			if err != nil {
				return "", reject(RejectUnreadable)
			}
			if bytes.Contains(bytes.ToLower(data), []byte("macroenabled")) {
				return "", reject(RejectMacro)
			}
		}
	}
	if word {
		return TypeDOCX, nil
	}
	return TypeXLSX, nil
}
