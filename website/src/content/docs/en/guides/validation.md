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
