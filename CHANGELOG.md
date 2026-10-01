# Changelog

## Unreleased

## 0.2.0 — 2026-10-01

- Add `checkChain` to check record fingerprints, predecessor links, and creation times.
- Add `VerifactuTransportError` with structured network, HTTP, and SOAP diagnostics.
  Network failures now wrap the original error in `cause`.
- Keep transport error excerpts within 500 UTF-16 code units without splitting characters.
- Report the full `SistemaInformatico.IdSistemaInformatico` path in software ID validation errors.
- Replace the documentation with simpler English and Spanish guides and verified examples.
