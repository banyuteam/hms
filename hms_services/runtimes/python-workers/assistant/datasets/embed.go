// Package datasets embeds the assistant's source-controlled datasets, so hms_services serves exactly the reviewed
// file of this build (package assistant validates it and publishes only an approved release).
package datasets

import _ "embed"

// GeneralHelp is general-help.seed.json: how to use HMS, no patient data.
//
//go:embed general-help.seed.json
var GeneralHelp []byte
