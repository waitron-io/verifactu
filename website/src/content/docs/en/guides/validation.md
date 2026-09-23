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

The total cross-check allows a €10 difference. AEAT exempts regimes `03`, `05`, `06`, `08`, and
`09`. `validate` skips both total checks when any tax line uses one of those regimes. The exemption
applies to the complete record, so a mixed-regime invoice does not produce a total mismatch warning.
AEAT preproduction confirmed this behavior for a record combining regimes `01` and `03`.

`validate` also checks that the invoice type agrees with the presence of `Destinatarios` and that
IVA, IPSI, and IGIC tax lines include `ClaveRegimen`, while other tax lines omit it. It does not
establish that a regime code is
appropriate for your transaction; inspect the AEAT response for each submitted record.

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
