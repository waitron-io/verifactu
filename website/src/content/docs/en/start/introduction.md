---
title: Introduction
description: What the library does and what your invoicing system must supply.
---

When you issue an invoice under Veri*Factu, its record must have a stable identity, a huella
(SHA-256 hash), and a link to the preceding record in its chain. You then send that record to AEAT,
Spain's tax agency, and retain the response. A QR code on the invoice lets someone check its
details.

`@waitron/verifactu` handles the protocol work: formatting, record construction, hashing,
validation, XML, QR payloads, and SOAP response parsing. You supply the invoice data, the preceding
record, a certificate-enabled transport, and durable storage. The API is stateless so your chain
update can happen in the same database transaction as the sale.

Start with [a first record](/verifactu/en/start/getting-started/), then
[send it to AEAT](/verifactu/en/guides/submit/). The generated
[API reference](/verifactu/api/) lists every public type and function.
