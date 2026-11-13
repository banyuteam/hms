package filestore

import (
	"archive/zip"
	"bytes"
	"io"
	"regexp"
	"strings"
)

const (
	maxZipEntries   = 2_000
	maxZipUnpacked  = 100 << 20
	maxZipPartBytes = 1 << 20 // [Content_Types].xml and relationship parts are read up to this size
)

// Sniff returns the media type from the file's bytes. Office files must be OOXML Word or Excel documents without
// macros, ActiveX, embedded objects or external templates; legacy binary Office files are refused.
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
		// OLE2: .doc/.xls and their macro variants.
		return "", reject(RejectLegacyOffice)
	}
	return "", reject(RejectUnsupported)
}

// External relationships that make Office fetch or run something when the file is opened (remote template injection,
// linked OLE objects, frames, sub-documents). Ordinary external hyperlinks are allowed.
var externalActive = regexp.MustCompile(`(?i)<Relationship\b[^>]*\bType="[^"]*/(attachedTemplate|oleObject|frame|subDocument)"[^>]*\bTargetMode="External"|` +
	`<Relationship\b[^>]*\bTargetMode="External"[^>]*\bType="[^"]*/(attachedTemplate|oleObject|frame|subDocument)"`)

// sniffOOXML reads only the archive directory and a few small XML parts; nothing is unpacked to disk.
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
		case strings.Contains(name, "/activex/"), strings.Contains(name, "/embeddings/"):
			return "", reject(RejectActiveContent)
		}
	}
	if unpacked > maxZipUnpacked {
		return "", reject(RejectTooLarge)
	}
	if !hasTypes || word == excel {
		return "", reject(RejectUnsupported)
	}
	for _, f := range zr.File {
		name := strings.ToLower(f.Name)
		if name != "[content_types].xml" && !strings.HasSuffix(name, ".rels") {
			continue
		}
		data, err := readPart(f)
		if err != nil {
			return "", reject(RejectUnreadable)
		}
		// Macro-enabled formats declare it in their content types even when renamed to .docx/.xlsx.
		if name == "[content_types].xml" && bytes.Contains(bytes.ToLower(data), []byte("macroenabled")) {
			return "", reject(RejectMacro)
		}
		if externalActive.Match(data) {
			return "", reject(RejectActiveContent)
		}
	}
	if word {
		return TypeDOCX, nil
	}
	return TypeXLSX, nil
}

func readPart(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, maxZipPartBytes))
}
