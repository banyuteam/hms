// Package catalogue keeps the catalogue of reference sources from outside HMS (contract catalogue-v1, ADR-SVC-012): web
// links and Excel, PDF, Word or image files, with the titles of the data each one holds. Any signed-in session of the
// organization reads it; holders of catalogue.manage change it, every change audited in its own transaction. Files are
// kept on the shared file volume (platform/filestore, ADR-SVC-013); the database (schema catalogue, migration 0022)
// keeps their key, type, size and SHA-256.
package catalogue

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"hms/services/platform/audit"
	"hms/services/platform/filestore"
	"hms/services/platform/iam"
)

// PermManage allows creating, changing, deleting, uploading and importing catalogue sources. Reading needs a session only.
const PermManage = "catalogue.manage"

var Permissions = []iam.PermissionDef{
	{Code: PermManage, Description: "Maintain the catalogue of external reference sources (add, edit, delete, upload files, import)"},
}

// Source types (catalogue.sources.source_type).
const (
	TypeURL   = "url"
	TypeExcel = "excel"
	TypePDF   = "pdf"
	TypeWord  = "word"
	TypeImage = "image"
)

var sourceTypes = map[string]bool{TypeURL: true, TypeExcel: true, TypePDF: true, TypeWord: true, TypeImage: true}

// Limits; the database enforces the same.
const (
	maxTitle       = 300
	maxPublisher   = 200
	maxDescription = 2000
	maxURL         = 2000
	maxDataTitles  = 200
	maxImport      = 500
	maxQuery       = 100
)

// Input is a source as a manager writes it (create and import).
type Input struct {
	Title       string   `json:"title"`
	Type        string   `json:"type"`
	Publisher   *string  `json:"publisher"`
	Description *string  `json:"description"`
	URL         *string  `json:"url"`
	DataTitles  []string `json:"data_titles"`
}

// Update changes a source; the type cannot change.
type Update struct {
	Version     int      `json:"version"`
	Title       string   `json:"title"`
	Publisher   *string  `json:"publisher"`
	Description *string  `json:"description"`
	URL         *string  `json:"url"`
	DataTitles  []string `json:"data_titles"`
}

// ImportDocument is the catalogue JSON document (format hms-catalogue, version 1).
type ImportDocument struct {
	Format  string  `json:"format"`
	Version int     `json:"version"`
	Sources []Input `json:"sources"`
}

// File is the stored file of a source.
type File struct {
	MediaType  string    `json:"media_type"`
	SizeBytes  int64     `json:"size_bytes"`
	UploadedAt time.Time `json:"uploaded_at"`
}

// Source is one catalogue entry as the API returns it.
type Source struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Type        string    `json:"type"`
	Publisher   *string   `json:"publisher"`
	Description *string   `json:"description"`
	URL         *string   `json:"url"`
	DataTitles  []string  `json:"data_titles"`
	File        *File     `json:"file"`
	Version     int       `json:"version"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Filter is a list request.
type Filter struct {
	Query string
	Type  string
	After string
	Limit int
}

// Page is one page of sources, most recently changed first.
type Page struct {
	Items     []Source `json:"items"`
	NextAfter string   `json:"next_after,omitempty"`
}

// ValidationError is a request the rules refuse; Field and Code are stable, Msg is safe to show.
type ValidationError struct{ Field, Code, Msg string }

func (e ValidationError) Error() string { return e.Msg }

// Problem is one refused import entry.
type Problem struct {
	Index int    `json:"index"`
	Field string `json:"field"`
	Code  string `json:"code"`
}

// ImportError lists every refused entry of an import; nothing was created.
type ImportError struct{ Problems []Problem }

func (e ImportError) Error() string {
	return fmt.Sprintf("%d catalogue entries refused", len(e.Problems))
}

var (
	ErrNotFound        = errors.New("catalogue source not found")
	ErrVersionConflict = errors.New("catalogue source changed since it was read")
	// ErrFilesUnavailable: file storage is not configured (FILES_DIR unset); uploads and downloads answer 503.
	ErrFilesUnavailable = errors.New("catalogue file storage not configured")
)

// MaxFileBytes is the catalogue's per-file limit (the database checks it too).
const MaxFileBytes = 20 << 20

// RejectTypeMismatch: the file is a supported type, but not the source's (e.g. a PDF on an Excel source).
const RejectTypeMismatch = "type_mismatch"

// fileTypes are the media types each file-type source accepts; a link has none.
var fileTypes = map[string][]string{
	TypeExcel: {filestore.TypeXLSX},
	TypeWord:  {filestore.TypeDOCX},
	TypePDF:   {filestore.TypePDF},
	TypeImage: {filestore.TypePNG, filestore.TypeJPEG},
}

// extensions name a download after its media type.
var extensions = map[string]string{
	filestore.TypeXLSX: ".xlsx", filestore.TypeDOCX: ".docx", filestore.TypePDF: ".pdf",
	filestore.TypePNG: ".png", filestore.TypeJPEG: ".jpg",
}

// Caller is the authenticated person acting, with the request's audit context.
type Caller struct {
	UserID         string
	OrganizationID string
	FacilityID     string
	RequestID      string
	ClientAddr     string
	Channel        string
}

// FileVolume is the catalogue namespace of the shared file volume (*filestore.Volume).
type FileVolume interface {
	Save(now time.Time, id string, data []byte) (string, error)
	Read(key string, sha256 []byte) ([]byte, error)
	Remove(key string) error
}

// Service runs catalogue commands and queries. files and scanner are nil when file storage is not configured: the
// catalogue still lists and edits sources, and uploads and downloads answer ErrFilesUnavailable.
type Service struct {
	db      *pgxpool.Pool
	files   FileVolume
	scanner filestore.Scanner
	now     func() time.Time
	// problem reports what could not be done after the answer was decided: a file left on the volume, an audit write.
	problem func(what string, err error)
}

func NewService(db *pgxpool.Pool, files FileVolume, scanner filestore.Scanner, onProblem func(what string, err error)) *Service {
	return &Service{db: db, files: files, scanner: scanner, now: time.Now, problem: onProblem}
}

// clean trims a single-line text field and refuses control characters; multiline allows line breaks and tabs.
func clean(field, v string, max int, multiline bool) (string, error) {
	v = strings.TrimSpace(v)
	if !utf8.ValidString(v) {
		return "", ValidationError{field, "invalid_text", field + " is not valid text."}
	}
	for _, r := range v {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\r' || r == '\t')) {
			return "", ValidationError{field, "invalid_text", field + " contains control characters."}
		}
	}
	if utf8.RuneCountInString(v) > max {
		return "", ValidationError{field, "too_long", fmt.Sprintf("%s is longer than %d characters.", field, max)}
	}
	return v, nil
}

func optional(field string, v *string, max int, multiline bool) (*string, error) {
	if v == nil {
		return nil, nil
	}
	s, err := clean(field, *v, max, multiline)
	if err != nil || s == "" {
		return nil, err
	}
	return &s, nil
}

// checkURL accepts an absolute https URL with a host and nothing that a browser could treat as another scheme.
func checkURL(raw string) (string, error) {
	s, err := clean("url", raw, maxURL, false)
	if err != nil {
		return "", err
	}
	u, perr := url.Parse(s)
	if perr != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || strings.ContainsAny(s, " \t\r\n\\") {
		return "", ValidationError{"url", "invalid_url", "The link must be a full https:// address."}
	}
	return s, nil
}

// fields are the checked values of a source.
type fields struct {
	title, kind            string
	publisher, description *string
	url                    *string
	dataTitles             []string
}

func check(title, kind string, publisher, description, link *string, dataTitles []string) (fields, error) {
	var f fields
	var err error
	if f.title, err = clean("title", title, maxTitle, false); err != nil {
		return f, err
	}
	if f.title == "" {
		return f, ValidationError{"title", "required", "A title is required."}
	}
	if !sourceTypes[kind] {
		return f, ValidationError{"type", "invalid_type", "Type must be url, excel, pdf, word or image."}
	}
	f.kind = kind
	if f.publisher, err = optional("publisher", publisher, maxPublisher, false); err != nil {
		return f, err
	}
	if f.description, err = optional("description", description, maxDescription, true); err != nil {
		return f, err
	}
	hasURL := link != nil && strings.TrimSpace(*link) != ""
	switch {
	case kind == TypeURL && !hasURL:
		return f, ValidationError{"url", "required", "A link needs its https:// address."}
	case kind != TypeURL && hasURL:
		return f, ValidationError{"url", "not_allowed", "Only a link has an address; a file is uploaded instead."}
	case hasURL:
		u, err := checkURL(*link)
		if err != nil {
			return f, err
		}
		f.url = &u
	}
	if len(dataTitles) > maxDataTitles {
		return f, ValidationError{"data_titles", "too_many", fmt.Sprintf("At most %d data titles.", maxDataTitles)}
	}
	f.dataTitles = make([]string, 0, len(dataTitles))
	for _, t := range dataTitles {
		s, err := clean("data_titles", t, maxTitle, false)
		if err != nil {
			return f, err
		}
		if s == "" {
			return f, ValidationError{"data_titles", "required", "A data title cannot be empty."}
		}
		f.dataTitles = append(f.dataTitles, s)
	}
	return f, nil
}

// ParseFilter checks list parameters.
func ParseFilter(q, kind, after, limit string) (Filter, error) {
	f := Filter{Limit: 50, After: after}
	var err error
	if f.Query, err = clean("q", q, maxQuery, false); err != nil {
		return f, err
	}
	if kind != "" && !sourceTypes[kind] {
		return f, ValidationError{"type", "invalid_type", "Unknown type."}
	}
	f.Type = kind
	if limit != "" {
		n, err := strconv.Atoi(limit)
		if err != nil || n < 1 || n > 100 {
			return f, ValidationError{"limit", "invalid_limit", "limit must be 1-100."}
		}
		f.Limit = n
	}
	if after != "" {
		if _, _, err := decodeCursor(after); err != nil {
			return f, ValidationError{"after", "invalid_cursor", "Invalid page cursor."}
		}
	}
	return f, nil
}

// Cursor: base64url of "<updated_at RFC3339Nano>|<id>" of the last item of the previous page.
func encodeCursor(s Source) string {
	return base64.RawURLEncoding.EncodeToString([]byte(s.UpdatedAt.UTC().Format(time.RFC3339Nano) + "|" + s.ID))
}

func decodeCursor(c string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", err
	}
	ts, id, ok := strings.Cut(string(b), "|")
	if !ok || !uuidLike(id) {
		return time.Time{}, "", errors.New("cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	return t, id, err
}

func uuidLike(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch {
		case i == 8 || i == 13 || i == 18 || i == 23:
			if r != '-' {
				return false
			}
		case !strings.ContainsRune("0123456789abcdef", r):
			return false
		}
	}
	return true
}

// likePattern escapes a search text for ILIKE.
func likePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

const sourceColumns = `s.id::text, s.title, s.source_type, s.publisher, s.description, s.url, s.version, s.updated_at,
	f.media_type, f.size_bytes, f.uploaded_at,
	coalesce((SELECT array_agg(d.title ORDER BY d.position) FROM catalogue.data_titles d WHERE d.source_id = s.id), '{}')
	FROM catalogue.sources s LEFT JOIN catalogue.files f ON f.source_id = s.id`

func scanSource(row pgx.Row) (Source, error) {
	var s Source
	var media *string
	var size *int64
	var uploaded *time.Time
	if err := row.Scan(&s.ID, &s.Title, &s.Type, &s.Publisher, &s.Description, &s.URL, &s.Version, &s.UpdatedAt,
		&media, &size, &uploaded, &s.DataTitles); err != nil {
		return s, err
	}
	if media != nil && size != nil && uploaded != nil {
		s.File = &File{MediaType: *media, SizeBytes: *size, UploadedAt: *uploaded}
	}
	return s, nil
}

// List returns one page of the caller's organization.
func (s *Service) List(ctx context.Context, c Caller, f Filter) (Page, error) {
	args := []any{c.OrganizationID, f.Type, "", time.Time{}, "", f.Limit + 1}
	if f.Query != "" {
		args[2] = likePattern(f.Query)
	}
	if f.After != "" {
		t, id, err := decodeCursor(f.After)
		if err != nil {
			return Page{}, ValidationError{"after", "invalid_cursor", "Invalid page cursor."}
		}
		args[3], args[4] = t, id
	}
	rows, err := s.db.Query(ctx, `SELECT `+sourceColumns+`
		WHERE s.organization_id = $1
		  AND ($2 = '' OR s.source_type = $2)
		  AND ($3 = '' OR s.title ILIKE $3 OR s.publisher ILIKE $3
		       OR EXISTS (SELECT 1 FROM catalogue.data_titles d WHERE d.source_id = s.id AND d.title ILIKE $3))
		  AND ($5 = '' OR (s.updated_at, s.id) < ($4, $5::uuid))
		ORDER BY s.updated_at DESC, s.id DESC
		LIMIT $6`, args...)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	page := Page{Items: []Source{}}
	for rows.Next() {
		src, err := scanSource(rows)
		if err != nil {
			return Page{}, err
		}
		page.Items = append(page.Items, src)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	if len(page.Items) > f.Limit {
		page.Items = page.Items[:f.Limit]
		page.NextAfter = encodeCursor(page.Items[len(page.Items)-1])
	}
	return page, nil
}

// Get returns one source of the caller's organization.
func (s *Service) Get(ctx context.Context, c Caller, id string) (Source, error) {
	return get(ctx, s.db, c.OrganizationID, id)
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func get(ctx context.Context, q querier, orgID, id string) (Source, error) {
	if !uuidLike(id) {
		return Source{}, ErrNotFound
	}
	src, err := scanSource(q.QueryRow(ctx, `SELECT `+sourceColumns+` WHERE s.id = $1 AND s.organization_id = $2`, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Source{}, ErrNotFound
	}
	return src, err
}

func (s *Service) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, s.db, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, fn)
}

func (s *Service) event(c Caller, action, resourceID string, detail map[string]string) audit.Event {
	return audit.Event{
		OccurredAt: s.now(), Category: audit.CategoryAdministration, Action: action, Outcome: audit.OutcomeSuccess,
		ActorType: audit.ActorUser, ActorID: c.UserID, OrganizationID: c.OrganizationID, FacilityID: c.FacilityID,
		ResourceType: "CatalogueSource", ResourceID: resourceID, Channel: c.Channel, RequestID: c.RequestID,
		ClientAddr: c.ClientAddr, Detail: detail,
	}
}

func insert(ctx context.Context, tx pgx.Tx, c Caller, f fields) (string, error) {
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO catalogue.sources (organization_id, title, source_type, publisher, description,
		url, created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id::text`,
		c.OrganizationID, f.title, f.kind, f.publisher, f.description, f.url, c.UserID).Scan(&id); err != nil {
		return "", err
	}
	return id, writeDataTitles(ctx, tx, id, f.dataTitles)
}

func writeDataTitles(ctx context.Context, tx pgx.Tx, id string, titles []string) error {
	for i, t := range titles {
		if _, err := tx.Exec(ctx, `INSERT INTO catalogue.data_titles (source_id, position, title) VALUES ($1, $2, $3)`,
			id, i+1, t); err != nil {
			return err
		}
	}
	return nil
}

// Create adds one source, with its audit event in the same transaction.
func (s *Service) Create(ctx context.Context, c Caller, in Input) (Source, error) {
	f, err := check(in.Title, in.Type, in.Publisher, in.Description, in.URL, in.DataTitles)
	if err != nil {
		return Source{}, err
	}
	var out Source
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		id, err := insert(ctx, tx, c, f)
		if err != nil {
			return err
		}
		if err := audit.Write(ctx, tx, s.event(c, "catalogue.source.created", id, map[string]string{"type": f.kind})); err != nil {
			return err
		}
		out, err = get(ctx, tx, c.OrganizationID, id)
		return err
	})
	return out, err
}

// lockForChange locks a source of the caller's organization and checks the version the caller read.
func lockForChange(ctx context.Context, tx pgx.Tx, c Caller, id string, version int) (kind string, err error) {
	if !uuidLike(id) {
		return "", ErrNotFound
	}
	var current int
	err = tx.QueryRow(ctx, `SELECT source_type, version FROM catalogue.sources WHERE id = $1 AND organization_id = $2
		FOR UPDATE`, id, c.OrganizationID).Scan(&kind, &current)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "", ErrNotFound
	case err != nil:
		return "", err
	case current != version:
		return "", ErrVersionConflict
	}
	return kind, nil
}

// Update changes title, publisher, description, link and data titles; the version must be the one read.
func (s *Service) Update(ctx context.Context, c Caller, id string, in Update) (Source, error) {
	if in.Version < 1 {
		return Source{}, ValidationError{"version", "required", "version is required."}
	}
	var out Source
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		kind, err := lockForChange(ctx, tx, c, id, in.Version)
		if err != nil {
			return err
		}
		f, err := check(in.Title, kind, in.Publisher, in.Description, in.URL, in.DataTitles)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE catalogue.sources SET title = $2, publisher = $3, description = $4, url = $5,
			version = version + 1, updated_by_user_id = $6 WHERE id = $1`,
			id, f.title, f.publisher, f.description, f.url, c.UserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM catalogue.data_titles WHERE source_id = $1`, id); err != nil {
			return err
		}
		if err := writeDataTitles(ctx, tx, id, f.dataTitles); err != nil {
			return err
		}
		if err := audit.Write(ctx, tx, s.event(c, "catalogue.source.updated", id, nil)); err != nil {
			return err
		}
		out, err = get(ctx, tx, c.OrganizationID, id)
		return err
	})
	return out, err
}

// Delete removes a source with its data titles and file record; the stored file is removed after the commit.
func (s *Service) Delete(ctx context.Context, c Caller, id string, version int) error {
	var key *string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockForChange(ctx, tx, c, id, version); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT storage_key FROM catalogue.files WHERE source_id = $1`, id).Scan(&key); err != nil &&
			!errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM catalogue.sources WHERE id = $1`, id); err != nil {
			return err
		}
		return audit.Write(ctx, tx, s.event(c, "catalogue.source.deleted", id,
			map[string]string{"had_file": strconv.FormatBool(key != nil)}))
	})
	if err == nil && key != nil {
		s.removeFile(*key)
	}
	return err
}

// removeFile deletes a file no longer referenced; a failure leaves an orphan on the volume and is reported.
func (s *Service) removeFile(key string) {
	if s.files == nil {
		return
	}
	if err := s.files.Remove(key); err != nil && s.problem != nil {
		s.problem("remove file "+key, err)
	}
}

// Import creates every source of the document in one transaction, or none.
func (s *Service) Import(ctx context.Context, c Caller, doc ImportDocument) (int, error) {
	if doc.Format != "hms-catalogue" || doc.Version != 1 {
		return 0, ValidationError{"format", "invalid_format", `The document must have "format": "hms-catalogue" and "version": 1.`}
	}
	if len(doc.Sources) == 0 || len(doc.Sources) > maxImport {
		return 0, ValidationError{"sources", "invalid_count", fmt.Sprintf("A document holds 1-%d sources.", maxImport)}
	}
	checked := make([]fields, len(doc.Sources))
	var problems []Problem
	for i, in := range doc.Sources {
		f, err := check(in.Title, in.Type, in.Publisher, in.Description, in.URL, in.DataTitles)
		var ve ValidationError
		switch {
		case errors.As(err, &ve):
			problems = append(problems, Problem{Index: i, Field: ve.Field, Code: ve.Code})
		case err != nil:
			return 0, err
		}
		checked[i] = f
	}
	if len(problems) > 0 {
		return 0, ImportError{Problems: problems}
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		for _, f := range checked {
			if _, err := insert(ctx, tx, c, f); err != nil {
				return err
			}
		}
		return audit.Write(ctx, tx, s.event(c, "catalogue.import", "", map[string]string{"created": strconv.Itoa(len(checked))}))
	})
	if err != nil {
		return 0, err
	}
	return len(checked), nil
}
