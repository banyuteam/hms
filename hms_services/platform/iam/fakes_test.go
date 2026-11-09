package iam

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"hms/services/integrations/legacyhms"
	"hms/services/platform/audit"
)

// memStore is an in-memory Store for unit tests. The PostgreSQL behaviour is covered by the integration tests.
type memStore struct {
	mu          sync.Mutex
	locked      map[string]time.Time
	failures    map[string]int
	users       map[string]*LinkedUser // by issuer|subject
	sessions    map[string]*SessionRecord
	perms       map[string][]string // user|facility -> permissions
	audit       []audit.Event
	nextID      int
	fail        error // every call fails with it when set
	revokeCalls []string
}

func newMemStore() *memStore {
	return &memStore{locked: map[string]time.Time{}, failures: map[string]int{}, users: map[string]*LinkedUser{},
		sessions: map[string]*SessionRecord{}, perms: map[string][]string{}}
}

func (m *memStore) LockedUntil(_ context.Context, k []byte) (time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.locked[string(k)], m.fail
}

func (m *memStore) RecordFailure(_ context.Context, k []byte, now time.Time, p LockoutPolicy) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failures[string(k)]++
	if m.failures[string(k)] >= p.Failures {
		m.locked[string(k)] = now.Add(p.Duration)
	}
	return m.fail
}

func (m *memStore) ClearFailures(_ context.Context, k []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.failures, string(k))
	return m.fail
}

func (m *memStore) FindByIdentity(_ context.Context, issuer, subject string) (LinkedUser, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return LinkedUser{}, false, m.fail
	}
	u, ok := m.users[issuer+"|"+subject]
	if !ok {
		return LinkedUser{}, false, nil
	}
	return *u, true, nil
}

func (m *memStore) Provision(_ context.Context, org, name, issuer, subject string, ev audit.Event) (LinkedUser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	u := &LinkedUser{User: User{ID: fmt.Sprintf("user-%d", m.nextID), OrganizationID: org, DisplayName: name, Status: "active"},
		IdentityID: fmt.Sprintf("ident-%d", m.nextID)}
	m.users[issuer+"|"+subject] = u
	ev.ResourceID = u.ID
	m.audit = append(m.audit, ev)
	return *u, nil
}

func (m *memStore) UpdateDisplayName(_ context.Context, id, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if u.ID == id {
			u.DisplayName = name
		}
	}
	return nil
}

func (m *memStore) CreateSession(_ context.Context, n NewSession, ev audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return m.fail
	}
	var rec SessionRecord
	for k, u := range m.users {
		if u.ID == n.UserID {
			issuer, subject, _ := strings.Cut(k, "|")
			rec = SessionRecord{IDHash: n.IDHash, User: u.User, IdentityIssuer: issuer, IdentitySubject: subject,
				FacilityID: n.FacilityID, LastSeenAt: n.CreatedAt, AbsoluteExpiresAt: n.AbsoluteExpiresAt}
		}
	}
	m.sessions[string(n.IDHash)] = &rec
	m.audit = append(m.audit, ev)
	return nil
}

func (m *memStore) LookupSession(_ context.Context, h []byte) (SessionRecord, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.fail != nil {
		return SessionRecord{}, false, m.fail
	}
	s, ok := m.sessions[string(h)]
	if !ok {
		return SessionRecord{}, false, nil
	}
	r := *s
	for _, u := range m.users { // reflect status changes
		if u.ID == r.User.ID {
			r.User = u.User
		}
	}
	return r, true, nil
}

func (m *memStore) TouchSession(_ context.Context, h []byte, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[string(h)]; ok && !s.Revoked {
		s.LastSeenAt = now
	}
	return nil
}

func (m *memStore) RevokeSession(_ context.Context, h []byte, _ time.Time, reason string, ev *audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[string(h)]
	if !ok || s.Revoked {
		return nil
	}
	s.Revoked = true
	m.revokeCalls = append(m.revokeCalls, reason)
	if ev != nil {
		m.audit = append(m.audit, *ev)
	}
	return nil
}

func (m *memStore) Permissions(_ context.Context, userID, facilityID string) ([]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string{}, m.perms[userID+"|"+facilityID]...), m.fail
}

func (m *memStore) Can(_ context.Context, userID, perm, facilityID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.perms[userID+"|"+facilityID] {
		if p == perm {
			return true, nil
		}
	}
	return false, m.fail
}

func (m *memStore) WriteAudit(_ context.Context, ev audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.audit = append(m.audit, ev)
	return nil
}

func (m *memStore) auditActions() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for _, e := range m.audit {
		out = append(out, e.Action+":"+e.Outcome)
	}
	return out
}

// fakeVerifier stands in for the legacy HMS.
type fakeVerifier struct {
	mu          sync.Mutex
	logins      map[string]string             // user ID -> password
	identities  map[string]legacyhms.Identity // user ID -> identity
	inactive    map[string]bool               // subject -> no longer active
	down        bool
	activeCalls int
}

func newFakeVerifier() *fakeVerifier {
	return &fakeVerifier{
		logins: map[string]string{"D001": "correct-horse", "3301": "battery-staple"},
		identities: map[string]legacyhms.Identity{
			"D001": {Issuer: legacyhms.IssuerDoctor, Subject: "D001", DisplayName: "dr. Test"},
			"3301": {Issuer: legacyhms.IssuerEmployee, Subject: "17", DisplayName: "Test Employee"},
		},
		inactive: map[string]bool{},
	}
}

func (f *fakeVerifier) Verify(_ context.Context, userID, password string) (legacyhms.Identity, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.down {
		return legacyhms.Identity{}, errors.New("legacy down")
	}
	if pw, ok := f.logins[userID]; !ok || pw != password {
		return legacyhms.Identity{}, legacyhms.ErrInvalid
	}
	return f.identities[userID], nil
}

func (f *fakeVerifier) Active(_ context.Context, _, subject string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.activeCalls++
	if f.down {
		return false, errors.New("legacy down")
	}
	return !f.inactive[subject], nil
}

// clock is a controllable time source.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}
