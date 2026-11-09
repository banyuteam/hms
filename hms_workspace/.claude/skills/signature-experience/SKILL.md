# Digital Signature Experience Engineering

## Use when
Implementing final medical record signing, amendment, signature display or public verification UI.

## Rules
- Client captures explicit signing intent and displays backend signing state.
- Backend owns signer identity, authorization, policy, document version binding, cryptographic evidence, trusted timestamp and audit.
- Bind signature to an immutable/versioned record representation.
- Distinguish draft, pending, signed, revoked/invalidated and amended states.
- Public verification URLs must use opaque, non-guessable identifiers and disclose minimum approved information.
- Do not expose patient data in URL query strings.
- Verification endpoint must report authenticity/status, not grant access to the medical record.
- A visual signature image or checkbox is not cryptographic proof.
