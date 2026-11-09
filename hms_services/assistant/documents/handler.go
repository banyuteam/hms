package documents

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"hms/services/clinical"
	"hms/services/core/config"
	"hms/services/core/httpx"
	"hms/services/platform/audit"
	"hms/services/platform/iam"
)

// PermAnalyze allows uploading documents for the assistant to read with an AI model (pilot role only, D-5). Linking a
// document to a visit also needs the visit's data permission (encounter.clinical.read), checked before anything else.
const PermAnalyze = "assistant.documents.analyze"

var Permissions = []iam.PermissionDef{
	{Code: PermAnalyze, Description: "Upload documents for the assistant to read with an AI model (pilot, ADR-SVC-009)"},
}

const (
	uploadsPerMinute = 20
	uploadTimeout    = 2 * time.Minute
	maxFieldBytes    = 64
	maxMultipart     = MaxFileBytes + 64<<10
)

var (
	visitPattern = regexp.MustCompile(`^[0-9/]{1,17}$`)
	idPattern    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// Scanner reports whether a file is clean and which engine decided (ClamAV).
type Scanner interface {
	Scan(ctx context.Context, b []byte) (clean bool, engine string, err error)
}

// PDFConverter turns DOCX/XLSX into PDF (Converter).
type PDFConverter interface {
	ToPDF(ctx context.Context, b []byte, mediaType string) ([]byte, error)
}

// Storage keeps files on the document volume (Volume).
type Storage interface {
	Save(now time.Time, id string, b []byte) (string, error)
	Remove(key string) error
}

// Store keeps document metadata (PgStore).
type Store interface {
	Insert(ctx context.Context, d Doc, ev audit.Event) (time.Time, error)
	Owned(ctx context.Context, id, userID string) (string, bool, error)
	MarkPurged(ctx context.Context, id string, ev audit.Event) error
}

// AuditWriter writes audit events outside a store transaction (rejections and denials).
type AuditWriter interface {
	WriteAudit(ctx context.Context, ev audit.Event) error
}

type Handler struct {
	store            Store
	audit            AuditWriter
	scanner          Scanner
	converter        PDFConverter
	storage          Storage
	iam              *iam.Handler
	retention        time.Duration
	logger           *slog.Logger
	limiter          *httpx.WindowLimiter
	now              func() time.Time
	newID            func() string
	can              func(r *http.Request, permission string) (bool, error)
	allowUpload      func(w http.ResponseWriter, r *http.Request) bool
	allowStateChange func(w http.ResponseWriter, r *http.Request) bool
}

func NewHandler(store Store, auditor AuditWriter, scanner Scanner, converter PDFConverter, storage Storage,
	iamHandler *iam.Handler, cfg config.Documents, logger *slog.Logger) *Handler {
	return &Handler{store: store, audit: auditor, scanner: scanner, converter: converter, storage: storage,
		iam: iamHandler, retention: cfg.Retention, logger: logger, now: time.Now, newID: newID,
		limiter: httpx.NewWindowLimiter(uploadsPerMinute, time.Minute, time.Now),
		can:     iamHandler.Can, allowUpload: iamHandler.AllowUpload, allowStateChange: iamHandler.AllowStateChange}
}

func (h *Handler) Register(mux *http.ServeMux) {
	route := func(pattern string, fn http.HandlerFunc) {
		mux.Handle(pattern, h.iam.RequireSession(h.iam.RequirePermission(PermAnalyze, fn)))
	}
	route("POST /api/v1/assistant/documents", h.upload)
	route("DELETE /api/v1/assistant/documents/{id}", h.remove)
}

// Uploaded is the answer to a successful upload (assistant-v1 1.2.0).
type Uploaded struct {
	DocumentID        string    `json:"document_id"`
	UploadedMediaType string    `json:"uploaded_media_type"`
	MediaType         string    `json:"media_type"`
	SizeBytes         int64     `json:"size_bytes"`
	PageCount         *int      `json:"page_count"`
	ExpiresAt         time.Time `json:"expires_at"`
}

// readUpload reads the multipart body: the visit number and exactly one file. The file name is never read.
func readUpload(r *http.Request) (visit string, file []byte, status int, code string) {
	mr, err := r.MultipartReader()
	if err != nil {
		return "", nil, http.StatusBadRequest, "invalid_request"
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return "", nil, http.StatusRequestEntityTooLarge, RejectTooLarge
		}
		if err != nil {
			return "", nil, http.StatusBadRequest, "invalid_request"
		}
		switch part.FormName() {
		case "visit_number":
			b, err := io.ReadAll(io.LimitReader(part, maxFieldBytes+1))
			if err != nil || len(b) > maxFieldBytes || visit != "" {
				return "", nil, http.StatusBadRequest, "invalid_request"
			}
			visit = string(b)
		case "file":
			if file != nil {
				return "", nil, http.StatusBadRequest, "invalid_request"
			}
			b, err := io.ReadAll(io.LimitReader(part, MaxFileBytes+1))
			if errors.As(err, &tooBig) || len(b) > MaxFileBytes {
				return "", nil, http.StatusRequestEntityTooLarge, RejectTooLarge
			}
			if err != nil {
				return "", nil, http.StatusBadRequest, "invalid_request"
			}
			file = b
		default:
			return "", nil, http.StatusBadRequest, "invalid_request"
		}
		part.Close()
	}
	if len(file) == 0 || !visitPattern.MatchString(visit) {
		return "", nil, http.StatusBadRequest, "invalid_request"
	}
	return visit, file, 0, ""
}

type processed struct {
	uploaded, stored string
	data             []byte
	pages            *int
	engine           string
}

// process checks a file in a fixed order: type from content, malware scan of the original bytes (so a malicious file
// never reaches the converter), Office conversion, then the PDF rules or an image re-encode.
func (h *Handler) process(ctx context.Context, b []byte) (processed, error) {
	typ, err := Sniff(b)
	if err != nil {
		return processed{}, err
	}
	p := processed{uploaded: typ, stored: typ}
	clean, engine, err := h.scanner.Scan(ctx, b)
	if err != nil {
		return processed{}, err
	}
	if !clean {
		return processed{}, reject(RejectMalware)
	}
	p.engine = engine
	switch typ {
	case TypeDOCX, TypeXLSX:
		pdf, err := h.converter.ToPDF(ctx, b, typ)
		if err != nil {
			return processed{}, err
		}
		b, p.stored = pdf, TypePDF
		fallthrough
	case TypePDF:
		pages, err := CheckPDF(b)
		if err != nil {
			return processed{}, err
		}
		p.data, p.pages = b, &pages
	case TypeJPEG, TypePNG:
		img, err := ReencodeImage(b, typ)
		if err != nil {
			return processed{}, err
		}
		p.data = img
	}
	return p, nil
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	if !h.allowUpload(w, r) {
		return
	}
	pr, _ := iam.PrincipalFrom(r.Context())
	if !h.limiter.Allow(pr.UserID) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, "too_many_requests", "Too many uploads. Try again later.")
		return
	}
	if pr.FacilityID == "" {
		httpx.WriteError(w, http.StatusForbidden, "forbidden", "Choose a facility first.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxMultipart)
	visit, file, status, code := readUpload(r)
	if status != 0 {
		httpx.WriteError(w, status, code, "The upload could not be read.")
		return
	}
	detail := map[string]string{"visit": visit, "size": strconv.Itoa(len(file))}

	// The visit's data permission is checked before the file is looked at.
	allowed, err := h.can(r, clinical.PermClinicalRead)
	if err != nil {
		unavailable(w)
		return
	}
	if !allowed {
		detail["reason"] = "reference_forbidden"
		if h.record(w, r, "assistant.document.upload", audit.OutcomeDenied, "", detail) {
			httpx.WriteError(w, http.StatusForbidden, "reference_forbidden", "You do not have permission to read this visit.")
		}
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), uploadTimeout)
	defer cancel()
	p, err := h.process(ctx, file)
	var rej *Rejection
	switch {
	case errors.As(err, &rej):
		detail["reason"] = rej.Code
		if h.record(w, r, "assistant.document.upload", audit.OutcomeFailure, "", detail) {
			status := http.StatusUnprocessableEntity
			if rej.Code == RejectUnsupported || rej.Code == RejectLegacyOffice {
				status = http.StatusUnsupportedMediaType
			} else if rej.Code == RejectTooLarge {
				status = http.StatusRequestEntityTooLarge
			}
			httpx.WriteError(w, status, rej.Code, "The file was not accepted.")
		}
		return
	case errors.Is(err, ErrScannerUnavailable):
		h.logger.Error("malware scanner unavailable", "err", err)
		httpx.WriteError(w, http.StatusServiceUnavailable, "scan_unavailable", "Files cannot be checked right now.")
		return
	case errors.Is(err, ErrConverterUnavailable):
		h.logger.Error("document converter unavailable", "err", err)
		httpx.WriteError(w, http.StatusServiceUnavailable, "conversion_unavailable", "Office files cannot be converted right now.")
		return
	case err != nil:
		h.logger.Error("document check failed", "err", err)
		unavailable(w)
		return
	}

	id := h.newID()
	sum := sha256.Sum256(p.data)
	key, err := h.storage.Save(h.now(), id, p.data)
	if err != nil {
		h.logger.Error("document not stored", "err", err)
		unavailable(w)
		return
	}
	doc := Doc{ID: id, OrganizationID: pr.OrganizationID, FacilityID: pr.FacilityID, UserID: pr.UserID,
		VisitNumber: visit, UploadedType: p.uploaded, StoredType: p.stored, Size: int64(len(p.data)), Pages: p.pages,
		SHA256: sum[:], StorageKey: key, ScanEngine: p.engine, Retention: h.retention}
	detail["uploaded_media_type"], detail["media_type"] = p.uploaded, p.stored
	detail["size"], detail["scan_engine"] = strconv.FormatInt(doc.Size, 10), p.engine
	if p.pages != nil {
		detail["pages"] = strconv.Itoa(*p.pages)
	}
	expires, err := h.store.Insert(ctx, doc, h.event(r, "assistant.document.upload", audit.OutcomeSuccess, id, detail))
	if err != nil {
		// No metadata, no file: never leave an unrecorded file on the volume.
		if rmErr := h.storage.Remove(key); rmErr != nil {
			h.logger.Error("orphan document file not removed", "err", rmErr)
		}
		h.logger.Error("document metadata not stored", "err", err)
		unavailable(w)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, Uploaded{DocumentID: id, UploadedMediaType: p.uploaded, MediaType: p.stored,
		SizeBytes: doc.Size, PageCount: p.pages, ExpiresAt: expires.UTC()})
}

// remove deletes the caller's own document from the volume at once (it stays recorded as purged).
func (h *Handler) remove(w http.ResponseWriter, r *http.Request) {
	if !h.allowStateChange(w, r) {
		return
	}
	id := r.PathValue("id")
	if !idPattern.MatchString(id) {
		httpx.WriteError(w, http.StatusNotFound, "document_not_found", "Document not found.")
		return
	}
	pr, _ := iam.PrincipalFrom(r.Context())
	key, found, err := h.store.Owned(r.Context(), id, pr.UserID)
	if err != nil {
		unavailable(w)
		return
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "document_not_found", "Document not found.")
		return
	}
	if err := h.storage.Remove(key); err != nil {
		h.logger.Error("document file not removed", "err", err)
		unavailable(w)
		return
	}
	if err := h.store.MarkPurged(r.Context(), id, h.event(r, "assistant.document.delete", audit.OutcomeSuccess, id,
		map[string]string{})); err != nil {
		h.logger.Error("document purge not recorded", "err", err)
		unavailable(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func unavailable(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusServiceUnavailable, "service_unavailable", "Temporarily unavailable.")
}

// event builds an audit event: identifiers, types, sizes and reasons only; never the file name or content.
func (h *Handler) event(r *http.Request, action, outcome, id string, detail map[string]string) audit.Event {
	p, _ := iam.PrincipalFrom(r.Context())
	ri := h.iam.RequestInfo(r)
	return audit.Event{OccurredAt: h.now(), Category: audit.CategoryDataAccess, Action: action, Outcome: outcome,
		ActorType: audit.ActorUser, ActorID: p.UserID, OrganizationID: p.OrganizationID, FacilityID: p.FacilityID,
		ResourceType: "AssistantDocument", ResourceID: id, Channel: ri.ClientType, RequestID: ri.RequestID,
		ClientAddr: ri.ClientAddr, Detail: detail}
}

// record writes an audit event; false = it could not be written and 503 has been answered (fail closed).
func (h *Handler) record(w http.ResponseWriter, r *http.Request, action, outcome, id string, detail map[string]string) bool {
	if err := h.audit.WriteAudit(r.Context(), h.event(r, action, outcome, id, detail)); err != nil {
		h.logger.Error("audit write failed; answer withheld", "action", action, "err", err)
		unavailable(w)
		return false
	}
	return true
}

// Retention adapts PgStore and the volume to the assistant retention loop.
type Retention struct {
	Store  *PgStore
	Volume Remover
}

func (rt Retention) Purge(ctx context.Context, now time.Time) (map[string]int64, error) {
	return rt.Store.Purge(ctx, now, rt.Volume)
}
