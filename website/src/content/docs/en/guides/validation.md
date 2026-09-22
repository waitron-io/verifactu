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

For a nine character Spanish taxpayer ID, `NIF_CONTROL` reports a wrong check character or an
unknown format. It covers DNI, X/Y/Z NIE, company IDs, and numeric K/L/M IDs. The newer K/L/M form
can contain letters in its seven character body; validation checks that form's shape only. It does
not confirm that form's check letter. `NIF_LENGTH` still reports IDs with the wrong length. A passing
local check does not prove that an ID was issued to a real taxpayer.
