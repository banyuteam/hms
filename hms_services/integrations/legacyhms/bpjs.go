package legacyhms

import "context"

// BPJS bridging data (ADR-SVC-007): what the legacy HMS stored from its BPJS VClaim / E-Klaim bridging, in the
// `bridging_*` and `inacbg_*` tables, for visits of payer `BPJ`. Read-only, one fixed statement per section, filtered by
// the encounter number through an indexed column (schema inventory 2026-11-09:
// hms_database/legacy/schema-inventory/bpjs-bridging.md).
//
// Data minimisation: `bridging_sep` also stores the patient's name, birth date, sex, BPJS card number, phone and
// address codes (`nama_pasien`, `tanggal_lahir`, `jkel`, `no_kartu`, `notelep`, `nomr`, `kdprop`…`nmkec`). They are
// already on the patient record and are never selected here.

// SEPColumns are the bridging_sep columns read, in order.
var SEPColumns = []string{"no_sep", "tglsep", "jnspelayanan", "klsrawat", "no_rujukan", "nmppkrujukan", "diagawal",
	"nmdiagnosaawal", "nmpolitujuan", "nmdpdjp", "tglpulang", "cob", "suplesi", "no_sep_suplesi"}

// SEPSection lists the SEPs issued for a visit (one visit can have more than one, e.g. a suplesi), oldest first.
var SEPSection = Section{"sep", "SELECT `no_sep`, CAST(`tglsep` AS CHAR), CAST(`jnspelayanan` AS CHAR), " +
	"CAST(`klsrawat` AS CHAR), `no_rujukan`, `nmppkrujukan`, `diagawal`, `nmdiagnosaawal`, `nmpolitujuan`, `nmdpdjp`, " +
	"CAST(`tglpulang` AS CHAR), CAST(`cob` AS CHAR), CAST(`suplesi` AS CHAR), `no_sep_suplesi` FROM `bridging_sep` " +
	"WHERE `no_rawat` = ? ORDER BY `tglsep`, `no_sep` LIMIT ?", 14, 20}

// SEPSampleSQL picks recent visits that have an SEP, for the counts-only check (`check-clinical-read`); not used by the
// API. The visit numbers are never printed.
const SEPSampleSQL = "SELECT `no_rawat` FROM `bridging_sep` WHERE `no_rawat` IS NOT NULL ORDER BY `tglsep` DESC LIMIT ?"

// BPJSStatements lists every BPJS bridging statement (allowlist test and the counts-only check).
func BPJSStatements() []string { return []string{SEPSection.SQL} }

// SEPSample returns up to limit visit numbers with an SEP, most recent SEP first (check only).
func (c *Clinical) SEPSample(ctx context.Context, limit int) ([]string, error) {
	rows, err := c.db.Query(ctx, SEPSampleSQL, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v *string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		if v != nil {
			out = append(out, *v)
		}
	}
	return out, rows.Err()
}

// SEP reads the SEPs of one visit (no rows = none recorded); truncated when the visit has more than the cap.
func (c *Clinical) SEP(ctx context.Context, number string) (TextRows, bool, error) {
	return c.readSection(ctx, SEPSection, number)
}
