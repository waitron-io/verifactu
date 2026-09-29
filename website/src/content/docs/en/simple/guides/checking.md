---
title: Checking records
description: Find problems before AEAT does, and tell errors from warnings.
---

The library checks a record against many of AEAT's published rules before you send it. It covers field
formats, tax IDs, amounts and totals, dates, invoice types, and the combinations of fields AEAT
allows.

## Errors and warnings

Every problem has a severity:

- An **error** means the record breaks AEAT's XML format, or a rule AEAT lists as a reason to
  reject a record. Fix it before you send.
- A **warning** means it breaks a rule AEAT lists as an error it still accepts: AEAT stores the
  record but flags it. Review it.

`assertValid` throws a `VerifactuValidationError` if there are any errors, and ignores warnings.
`validate` returns every problem, which suits a form or a log:

```ts
import { validate } from "@waitron/verifactu";

const broken = { ...record, SistemaInformatico: { ...software, IdSistemaInformatico: "001" } };

for (const issue of validate(broken)) {
  console.log(issue.severity, issue.code, issue.field); // error ID_SISTEMA_LENGTH SistemaInformatico.IdSistemaInformatico
}
```

Each problem has a `code` you can match in your code, the `field` it applies to, and a readable
`message`. The thrown error has the same list in its `issues` property:

```ts
import { assertValid, VerifactuValidationError } from "@waitron/verifactu";

try {
  assertValid(broken);
} catch (error) {
  if (error instanceof VerifactuValidationError) {
    console.log(error.issues.length); // 1
  }
}
```

## Build first, then check

Check the record the builder returned, not your input. If you change a record after building it,
its fingerprint no longer matches and you get a `HUELLA_MISMATCH` warning.

## Checks that depend on today's date

Some rules depend on the current date. For example, an invoice can't be dated in the future. Pass
`{ now }` to control the clock in tests:

```ts
const lastYear = new Date("2025-07-20T12:00:00Z");
console.log(validate(record, { now: lastYear }).some((issue) => issue.severity === "error")); // true
```

## What checking can't tell you

- Whether a tax ID belongs to a real, registered business. Only AEAT knows that.
- Whether you chose the right tax codes for the sale. It checks that the codes are allowed
  together, not that they fit the facts.
- Whether your stored chain is complete. See [Linking records](/verifactu/en/simple/guides/chain/).

AEAT's reply is the final word on every record, so read it even when checking passed.

## Checks when you send

`client.submit` also checks the batch before sending anything. It throws if the header's tax ID
doesn't match every record's issuer, or if the batch is empty or has more than 1,000 records.
