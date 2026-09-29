# Changelog

## Unreleased

- `createClient` and the `submitRecords` facade now throw the exported
  `VerifactuTransportError` for network, HTTP and SOAP failures. Its `kind`
  distinguishes those stages; `status`, `faultCode`, `faultReason` and a
  bounded `bodyExcerpt` retain response diagnostics when available. Network
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
