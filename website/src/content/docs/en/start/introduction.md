---
title: Choose the right starting point
description: Where this protocol library fits in your invoicing application.
---

You have an invoicing application and want to add Veri*Factu without handing it your database or
invoice workflow. This library accepts the invoice data and the preceding record you supply,
then builds an **alta** (new invoice record), calculates its **huella** (SHA-256 hash), validates
it, prepares XML and a QR lookup URL, and parses AEAT responses. AEAT is Spain's tax agency.
Your deployed **SIF** (invoicing system) decides when to issue, how to store, and what to do after
each response.

Choose this library if you want TypeScript protocol functions inside an existing application and
prefer to own storage, numbering, retries, certificate transport, and QR image rendering. Its
stateless boundary lets you save the completed record alongside the invoice in your own transaction;
you must design that transaction and the chain's concurrency rules yourself.

If you need a package that manages a series, signs records for the NO Veri*Factu mode, or renders
QR images, compare the [series and XAdES facilities in `@inoguerols/verifactu`](https://github.com/inoguerols/verifactu#readme).
If you want a client that configures the certificate and includes QR rendering and a CLI, compare
[`verifactu-sdk`](https://github.com/eloi24/verifactu-sdk/blob/main/README.md), whose own README
currently calls it alpha. Check each project's current API and deployment fit before choosing.
This package neither signs records nor decides whether your system meets the law.

Start with [one record and a local response](/verifactu/en/start/getting-started/). The
[submission walkthrough](/verifactu/en/guides/submit/) then adds your database, certificate
transport, response handling and consultation. Read [the SIF boundary](/verifactu/en/start/not-a-sif/)
before using the example as a deployment design.
