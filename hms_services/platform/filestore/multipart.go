package filestore

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"unicode/utf8"
)

// Upload is a multipart/form-data request with one file and a few short text fields. The part's file name and
// Content-Type are ignored: Accept decides the type from the content.
type Upload struct {
	Fields map[string]string
	File   []byte
}

const (
	maxFields     = 20
	maxFieldBytes = 4 << 10
	envelopeBytes = 64 << 10 // boundaries, part headers and fields around the file
)

// ReadMultipart reads the request body, at most maxFileBytes of file plus a small envelope. The file is the one part
// named fileField; every other part is a UTF-8 text field, each name at most once. Refusals are *Rejection with
// RejectInvalidUpload or RejectTooLarge. Call iam.Handler.AllowUpload first.
func ReadMultipart(w http.ResponseWriter, r *http.Request, fileField string, maxFileBytes int) (Upload, error) {
	mt, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/form-data" || params["boundary"] == "" {
		return Upload{}, reject(RejectInvalidUpload)
	}
	if maxFileBytes <= 0 || maxFileBytes > MaxFileBytes {
		maxFileBytes = MaxFileBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, int64(maxFileBytes+envelopeBytes))
	mr, err := r.MultipartReader()
	if err != nil {
		return Upload{}, reject(RejectInvalidUpload)
	}
	u := Upload{Fields: map[string]string{}}
	gotFile := false
	for n := 0; ; n++ {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Upload{}, uploadErr(err)
		}
		if n >= maxFields {
			return Upload{}, reject(RejectInvalidUpload)
		}
		name := part.FormName()
		switch {
		case name == fileField:
			if gotFile {
				return Upload{}, reject(RejectInvalidUpload)
			}
			gotFile = true
			if u.File, err = io.ReadAll(io.LimitReader(part, int64(maxFileBytes)+1)); err != nil {
				return Upload{}, uploadErr(err)
			}
			if len(u.File) > maxFileBytes {
				return Upload{}, reject(RejectTooLarge)
			}
		case name == "" || part.FileName() != "":
			return Upload{}, reject(RejectInvalidUpload) // a second file under another name
		default:
			if _, dup := u.Fields[name]; dup {
				return Upload{}, reject(RejectInvalidUpload)
			}
			v, err := io.ReadAll(io.LimitReader(part, maxFieldBytes+1))
			if err != nil {
				return Upload{}, uploadErr(err)
			}
			if len(v) > maxFieldBytes || !utf8.Valid(v) {
				return Upload{}, reject(RejectInvalidUpload)
			}
			u.Fields[name] = string(v)
		}
		part.Close()
	}
	if !gotFile {
		return Upload{}, reject(RejectInvalidUpload)
	}
	return u, nil
}

func uploadErr(err error) error {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		return reject(RejectTooLarge)
	}
	return reject(RejectInvalidUpload)
}
