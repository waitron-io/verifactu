# Changelog

## Unreleased

- HTTP and SOAP transport error excerpts remain at most 500 UTF-16 code units
  and now drop a high surrogate at the boundary instead of exposing half of a
  character in `bodyExcerpt` or the error message.

- Export `checkChain` to check caller-supplied alta/cancellation records in order.
  It reports own-hash, predecessor identity/hash and generation-time issues with
  a zero-based record position (`-1` for an explicit predecessor boundary).
  `scope` distinguishes an empty input, a chain supplied from its first record,
  and a partial segment. A missing external predecessor is an issue; even a
  supplied boundary does not verify its earlier ancestry. Equal generation
  instants are allowed; malformed times skip order comparisons with their
  immediate neighbours. The checker uses the existing hash and timestamp rules,
  compares pointer literals exactly, and does not sort, repair, persist or
  mutate records. It checks neither unhashed content nor AEAT acceptance and
  does not decide whether issuance continues. Schema/business validation and
  taxpayer/software chain selection remain your responsibility.

- `createClient` and the `submitRecords` facade now throw the exported
  `VerifactuTransportError` for network, HTTP and SOAP failures. Its `kind`
  distinguishes those stages; `status`, `faultCode`, `faultReason` and a
  bounded `bodyExcerpt` retain response diagnostics when available. A body-read
  failure has `kind: "network"` and retains the received HTTP status. Network
  failures now wrap the original exception in `cause` (including its own
  cause), preserving its message rather than its object identity or subclass.
  Existing HTTP/SOAP messages remain useful; malformed faults also retain
  their parsing cause. Serializer and ordinary response-parser failures are
  unchanged. These fields do not establish retry eligibility or whether a
  submitted record reached AEAT. Request options are not attached; callers
  should select what to log because causes and server text can contain secrets.

- Validation issues `ID_SISTEMA_LENGTH` and `ID_SISTEMA_CHARSET` now report
  `SistemaInformatico.IdSistemaInformatico` in `ValidationIssue.field`. This also
  changes the field path shown by `VerifactuValidationError`.
