---
title: Validate a record
description: Stop blocking local issues before submitting a record to AEAT.
---

Check the completed record before you put it in a submission batch:

```ts
import { validate } from "@waitron/verifactu";

const issues = validate(record);
for (const issue of issues) {
  console.log(issue.severity, issue.code, issue.field, issue.message);
}
if (issues.some((issue) => issue.severity === "error")) {
  throw new Error("Do not submit a record with blocking issues");
}
```

An `error` blocks submission. A `warning` calls for review but can describe a record AEAT would
accept, such as a total outside a recommended cross-check tolerance. Validation catches local
format and selected AEAT rules; AEAT's response remains authoritative. Inspect every returned
line after submission.

The total cross-check allows a €10 difference. AEAT exempts regimes `03`, `05`, `06`, `08`, and
`09`. `validate` skips the cross-check when every tax line uses one of those regimes; it keeps an
advisory warning for a mixed-regime record with mismatched totals.

`validate` also checks that the invoice type agrees with the presence of `Destinatarios` and that
IVA, IPSI, and IGIC tax lines include `ClaveRegimen`, while other tax lines omit it. It does not
establish that a regime code is
appropriate for your transaction; inspect the AEAT response for each submitted record.

For a nine character Spanish taxpayer ID, `NIF_CONTROL` reports a wrong check character or an
unknown format. It covers DNI, X/Y/Z NIE, company IDs, and numeric K/L/M IDs. The newer K/L/M form
can contain letters in its seven character body; validation checks that form's shape only. It does
not confirm that form's check letter. `NIF_LENGTH` still reports IDs with the wrong length. A passing
local check does not prove that an ID was issued to a real taxpayer.
