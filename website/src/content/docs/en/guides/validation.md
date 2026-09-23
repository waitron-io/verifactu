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

For a nine character Spanish taxpayer ID, `NIF_CONTROL` reports a wrong check character or an
unknown format. It covers DNI, X/Y/Z NIE, company IDs, and numeric K/L/M IDs. The newer K/L/M form
can contain letters in its seven character body; validation checks that form's shape only. It does
not confirm that form's check letter. `NIF_LENGTH` still reports IDs with the wrong length. A passing
local check does not prove that an ID was issued to a real taxpayer. `NOMBRE_SISTEMA_LENGTH` reports
a `SistemaInformatico.NombreSistemaInformatico` longer than the schema's 30-character maximum.
