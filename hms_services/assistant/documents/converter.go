package documents

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"time"
)

// Converter turns DOCX and XLSX into PDF through the isolated converter container (LibreOffice behind Gotenberg's
// HTTP API, D-10). The container has no outbound network; it gets the file and returns the PDF.
type Converter struct {
	URL    *url.URL
	Client *http.Client
}

// ErrConverterUnavailable: the converter did not answer or failed; the file is refused for now.
var ErrConverterUnavailable = errors.New("document converter unavailable")

func NewConverter(u *url.URL) *Converter {
	return &Converter{URL: u, Client: &http.Client{Timeout: 90 * time.Second}}
}

// ToPDF converts one Office file. A file the converter cannot read is a Rejection; anything else is unavailability.
func (c *Converter) ToPDF(ctx context.Context, b []byte, mediaType string) ([]byte, error) {
	name := "document.docx"
	if mediaType == TypeXLSX {
		name = "document.xlsx"
	} else if mediaType != TypeDOCX {
		return nil, reject(RejectUnsupported)
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	// A fixed name: the converter picks the format by extension, and the user's file name never leaves hms-services.
	fw, err := mw.CreateFormFile("files", name)
	if err != nil {
		return nil, err
	}
	if _, err := fw.Write(b); err != nil {
		return nil, err
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	endpoint := c.URL.JoinPath("forms", "libreoffice", "convert")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConverterUnavailable, err)
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusBadRequest:
		return nil, reject(RejectUnreadable)
	case res.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%w: status %d", ErrConverterUnavailable, res.StatusCode)
	}
	pdf, err := io.ReadAll(io.LimitReader(res.Body, MaxFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrConverterUnavailable, err)
	}
	if len(pdf) > MaxFileBytes {
		return nil, reject(RejectTooLarge)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		return nil, fmt.Errorf("%w: not a PDF", ErrConverterUnavailable)
	}
	return pdf, nil
}
