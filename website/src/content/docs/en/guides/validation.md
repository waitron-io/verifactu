---
title: Validate a record
description: Stop blocking local issues before submitting a record to AEAT.
---

Check the completed record before you put it in a submission batch:

```ts
import { assertValid } from "@waitron/verifactu";

assertValid(record);
```

`assertValid` throws `VerifactuValidationError` when an `error` blocks submission. Its message names
each invalid field and its `issues` property contains the structured validation issues. Call
`validate(record)` instead when you need to display all issues in a form. A `warning` calls for
review but does not make `assertValid` throw because AEAT may still accept the record. Validation
catches local format and selected AEAT rules; AEAT's response remains authoritative. Inspect every
returned line after submission.

A predecessor hash must contain exactly 64 uppercase hexadecimal characters. `validate` reports
`HUELLA_ANTERIOR_FORMAT` as a warning for both alta and cancellation records. AEAT treats this
format problem as non-rejecting, so `assertValid` does not block the submission, but you should
still investigate it before relying on the chain. A value longer than 64 characters or containing
an XML control character remains blocking because it breaks the schema or parsing.

If you change a record after the builder has hashed it, `validate` reports `HUELLA_MISMATCH`. A
hash that is not 64 uppercase hexadecimal characters produces `HUELLA_FORMAT`. These are warnings
when the value fits AEAT's 64-character XML limit and contains no XML control characters, so
`assertValid` does not block a record that AEAT would accept with errors. A longer value breaks
the XML schema and remains an error. Check the warnings before filing rather than assuming
acceptance means the hash is correct.

`FechaHoraHusoGenRegistro` must be a real calendar instant with a numeric offset. A value more than
one minute ahead of the current time produces the `FECHA_HORA_FUTURE` warning on both alta and
cancellation records. The comparison uses the represented instant, so two timestamps with different
offsets are compared correctly. Pass `{ now }` as the second argument when you need a controlled
clock. Because AEAT classifies this condition as non-rejecting, `assertValid` does not throw for it.

The total cross-check allows a €10 difference. AEAT exempts regimes `03`, `05`, `06`, `08`, and
`09`. `validate` skips both total checks when any tax line uses one of those regimes. The exemption
applies to the complete record, so a mixed-regime invoice does not produce a total mismatch warning.
AEAT preproduction confirmed this behavior for a record combining regimes `01` and `03`.

`validate` also checks that the invoice type agrees with the presence of `Destinatarios` and that
IVA, IPSI, and IGIC tax lines include `ClaveRegimen`, while other tax lines omit it. It does not
decide which regime describes your business transaction, but it does reject codes outside the
published list for that tax and combinations that break AEAT's regime-specific rules. Inspect the
AEAT response for each submitted record.

IPSI has a dated transition. A missing or unknown IPSI regime produces a warning through 31
December 2026 because AEAT accepts the record with errors during that period. It becomes an error
on 1 January 2027, when AEAT starts rejecting the record. Pass `{ now }` to `validate` or
`assertValid` when you need to test either side of that boundary. The boundary uses that instant in
the numeric offset carried by `FechaHoraHusoGenRegistro`, so midnight follows the record's declared
local date. A malformed timestamp already produces `FECHA_HORA_FORMAT`; in that case the IPSI issue
stays a warning instead of adding a second date-derived error.

Correction fields are checked together. `RechazoPrevio` values `S` and `X` require
`Subsanacion: "S"`; `FacturasRectificadas` is limited to `R1`–`R5`; `FacturasSustituidas` is limited
to `F3`; and `ImporteRectificacion` is required for, and allowed only with,
`TipoRectificativa: "S"`. A present reference group must contain at least one invoice. Each
referenced invoice receives local NIF, 1–60-character invoice-number, and real-date checks. The
main invoice's narrower QR-safe alphabet is not applied to these references because they never
enter the QR payload. AEAT remains responsible for confirming that a NIF is registered.

For an alta, `FechaExpedicionFactura` cannot be before 28 October 2024 or after the current date.
It also cannot be before `FechaOperacion` on an IVA or IGIC line unless that line uses regime `14`
or `15`. `FechaOperacion` cannot be more than 20 years old or later than the end of the next
calendar year. A future operation date on IVA or IGIC is likewise limited to regimes `14` and `15`.
For a mixed record, every applicable IVA or IGIC line must meet that exception. The current-date
checks use the numeric offset in `FechaHoraHusoGenRegistro`, rather than the computer's time zone.
Tests and applications with a controlled clock can pass `{ now }` as the second argument to
`validate` or `assertValid`.

The legal-status flags are also cross-checked with `TipoFactura`:
`FacturaSimplificadaArt7273: "S"` is limited to `F1`, `F3`, and `R1`–`R4`, while
`FacturaSinIdentifDestinatarioArt61d: "S"` is limited to `F2` and `R5`. `Macrodato` must be present
when the absolute `ImporteTotal` reaches €100,000,000. The official rule requires the field; because
the XSD permits both `S` and `N`, local validation does not replace that presence rule with a
truth-value rule.

For third-party issuance, `EmitidaPorTerceroODestinatario: "T"` requires `Tercero`; `"D"` requires
`Destinatarios`; and `Tercero` is forbidden in any other case. A third party must use exactly one of
`NIF` and `IDOtro`. Local validation checks Spanish NIF form and inequality with the invoice issuer,
the Spanish `IDOtro` restriction, the ban on `IDType: "07"`, and AEAT's published uppercase EU VAT
number shapes for `IDType: "02"`, including the dated GB/XI transition. Only AEAT can confirm that
a well-formed NIF or VAT number is registered.

Every recipient must likewise use exactly one of `NIF` and `IDOtro`. Recipient `IDType: "07"`
requires `CodigoPais: "ES"`; Spanish recipients may use only `IDType: "03"` or `"07"`; and
`IDType: "02"` must match a published EU VAT shape and may appear only on `F1`, `F3`, or `R1`–`R4`.
These invoice families are also the only ones that can use recipient-issued (`"D"`) records,
because `F2` and `R5` forbid `Destinatarios`.

For IVA `S1` detail lines, `validate` checks the official rate list and the dated windows for the
temporary `5`, `2`, and `7.5` percent rates. When you include `TipoRecargoEquivalencia`, its value
must match both `TipoImpositivo` and the effective operation date. The effective date is
`FechaOperacion`, falling back to `FechaExpedicionFactura` when omitted.

`BaseImponibleACoste` is available only for regime `06`, IPSI, or another tax. Reverse-charge `S2`
lines require an eligible invoice family plus zero `TipoImpositivo` and `CuotaRepercutida`. IVA
`N1`/`N2` lines must omit rate, charged-tax, and equivalence-surcharge fields. All exempt lines must
omit those fields. Exemption codes are checked against the IVA/IGIC lists and regime-01
restrictions; supplied recipients of an IVA `E5` line must use `IDOtro`. Finally, `Cupon: "S"` is
valid only on `R1` and `R5`.

Regime-specific validation covers the published operation, rate, base-at-cost, invoice-type,
recipient-identity, and operation-date conditions for IVA/IGIC regimes `02`, `03`, `04`, `06`,
`07`, `08`, `10`, `11`, `14`, and IGIC `20`. In particular, regime `14` requires
`FechaOperacion` after the invoice issue date and recipients whose NIF begins with `P`, `Q`, `S`,
or `V`.

Every `S1` line must include `TipoImpositivo` and `CuotaRepercutida`. Unless the record is a
correction by differences (`TipoRectificativa: "I"`) or an `R2`/`R3` invoice, the charged tax must
have the same sign as its applicable base and equal that base multiplied by the rate within AEAT's
±€10 tolerance. When `BaseImponibleACoste` is present, it is the applicable base; otherwise the
check uses `BaseImponibleOimporteNoSujeto`. A zero charged tax is valid only when the applicable
base or rate is zero. A nonzero `CuotaRepercutida` is not permitted outside `S1`. Existing, more
specific issues report the same violation for `S2`, IVA `N1`/`N2`, and exempt lines, so you receive
one useful issue instead of duplicate messages.

For a simplified `F2` invoice, the sum of `BaseImponibleOimporteNoSujeto` and
`CuotaRepercutida` across every detail line may reach €3,010, including AEAT's +€10 acceptance
margin. The limit does not apply when you supply `NumRegistroAcuerdoFacturacion` or set
`FacturaSinIdentifDestinatarioArt61d: "S"`. Agreement numbers are limited to the XSD's 15-character
maximum; only AEAT can confirm that a well-formed number is registered.
`IdAcuerdoSistemaInformatico` has its own 16-character maximum and likewise requires AEAT to
confirm that the supplied ID exists.

Keep `IDEmisorFactura` equal to `Cabecera.ObligadoEmision.NIF`. `serializeEnvio` rejects the batch
when those values differ, before it creates XML. AEAT permits a wider printable-ASCII alphabet in
`NumSerieFactura`, but this library accepts only letters, digits, `/`, `_`, `.`, and `-`. That
narrower alphabet keeps the invoice number unambiguous when it becomes a QR query parameter.

For a nine character Spanish taxpayer ID, `NIF_CONTROL` reports a wrong check character or an
unknown format. It covers DNI, X/Y/Z NIE, company IDs, and numeric K/L/M IDs. The newer K/L/M form
can contain letters in its seven character body; validation checks that form's shape only. It does
not confirm that form's check letter. `NIF_LENGTH` still reports IDs with the wrong length. A passing
local check does not prove that an ID was issued to a real taxpayer. `NOMBRE_SISTEMA_LENGTH` reports
a `SistemaInformatico.NombreSistemaInformatico` longer than the schema's 30-character maximum.

`SistemaInformatico` must identify the software producer with exactly one of `NIF` and `IDOtro`.
A Spanish `IDOtro` producer must use `IDType: "03"`; `IDType: "07"` is not allowed; and
`IDType: "02"` must match one of AEAT's published uppercase EU VAT-number structures. The GB/XI
rule follows the invoice's effective operation date. `IdSistemaInformatico` must contain exactly
two uppercase A-Z letters or digits, and `NombreSistemaInformatico`,
`TipoUsoPosibleSoloVerifactu`, and `TipoUsoPosibleMultiOT` must contain a value. These checks apply
to alta and cancellation records. Only AEAT can confirm that a locally well-formed producer
identity is registered.

When you upgrade, correct any one-character or lowercase system ID and any blank software name or
usage flag before deploying. Earlier versions accepted those values; `assertValid` now blocks them.
