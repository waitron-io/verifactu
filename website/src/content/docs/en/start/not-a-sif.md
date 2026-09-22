---
title: Is this a SIF?
description: The boundary between a protocol library and a deployed invoicing system.
---

**This library is a tool for building SIFs. It is not itself a SIF.** A _sistema informático de
facturación_ is your deployed invoicing system. Its duties include conserving records, preventing
undetected alteration, and making records accessible. Source code alone cannot meet those duties.

Your deployment must keep invoice numbers and chain state durable, handle retries without creating
new identities, store AEAT's responses and CSV on receipt, and provide the required access and
declaración responsable for that installation. The library supplies record and protocol functions;
you design and operate the surrounding system.

Read the repository's [provenance and disclaimer](https://github.com/waitron-io/verifactu/blob/main/PROVENANCE.md)
before treating any example here as a complete compliance design.
