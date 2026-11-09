package documents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

// ClamAV scans files with clamd over TCP (INSTREAM). The file is streamed in chunks; nothing is written to disk.
type ClamAV struct {
	Addr    string
	Timeout time.Duration
}

const clamChunk = 64 << 10

// ErrScannerUnavailable: the scanner did not answer or answered with an error. The file is refused (D-9).
var ErrScannerUnavailable = errors.New("malware scanner unavailable")

// Scan reports whether the file is clean and the engine version that decided it (e.g. "ClamAV 1.4.2/27450").
func (c *ClamAV) Scan(ctx context.Context, b []byte) (bool, string, error) {
	engine, err := c.command(ctx, func(conn net.Conn) error {
		_, err := conn.Write([]byte("zVERSION\x00"))
		return err
	})
	if err != nil {
		return false, "", err
	}
	if i := strings.Index(engine, "/"); i > 0 {
		if j := strings.Index(engine[i+1:], "/"); j > 0 {
			engine = engine[:i+1+j]
		}
	}
	if len(engine) > 128 {
		engine = engine[:128]
	}
	reply, err := c.command(ctx, func(conn net.Conn) error {
		if _, err := conn.Write([]byte("zINSTREAM\x00")); err != nil {
			return err
		}
		var size [4]byte
		for off := 0; off < len(b); off += clamChunk {
			end := min(off+clamChunk, len(b))
			binary.BigEndian.PutUint32(size[:], uint32(end-off))
			if _, err := conn.Write(size[:]); err != nil {
				return err
			}
			if _, err := conn.Write(b[off:end]); err != nil {
				return err
			}
		}
		binary.BigEndian.PutUint32(size[:], 0)
		_, err := conn.Write(size[:])
		return err
	})
	if err != nil {
		return false, "", err
	}
	switch {
	case strings.HasSuffix(reply, " OK"):
		return true, engine, nil
	case strings.HasSuffix(reply, " FOUND"):
		return false, engine, nil
	}
	return false, "", fmt.Errorf("%w: unexpected reply", ErrScannerUnavailable)
}

// command opens a connection, sends one command and reads the NUL-terminated reply.
func (c *ClamAV) command(ctx context.Context, send func(net.Conn) error) (string, error) {
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", c.Addr)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrScannerUnavailable, err)
	}
	defer conn.Close()
	deadline := time.Now().Add(timeout)
	if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
		deadline = dl
	}
	_ = conn.SetDeadline(deadline)
	if err := send(conn); err != nil {
		return "", fmt.Errorf("%w: %v", ErrScannerUnavailable, err)
	}
	reply, err := bufio.NewReader(conn).ReadBytes(0)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrScannerUnavailable, err)
	}
	return string(bytes.TrimRight(reply, "\x00\n")), nil
}
