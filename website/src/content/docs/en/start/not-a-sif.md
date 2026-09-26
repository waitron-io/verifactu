---
title: Is this a SIF?
description: The boundary between a protocol library and a deployed invoicing system.
---

**This library is a tool for building SIFs. It is not itself a SIF.** A _sistema informático de
facturación_ is your deployed invoicing system. Its duties depend on the mode and architecture you
operate. Source code alone cannot choose or prove them.

Your deployment must keep invoice numbers and chain state durable, handle retries without creating
new identities, store AEAT's responses and CSV on receipt, and provide the required access and
declaración responsable for that installation. The library supplies record and protocol functions;
you design and operate the surrounding system.

## Keep installation and invoice identities permanent

Allocate `NumeroInstalacion` outside this package and never reuse it for the same invoice issuer,
even after reinstalling the same product. In a multi-tenant service, calculate
`IndicadorMultiplesOT` for the current user: use `"S"` when that user has more than one invoicing
operation configured, including inactive ones. Do not derive it from the service's global customer
count.

Keep drafts, proformas, and imported invoices outside your own record-building path. An imported
record remains attributable to its original SIF. Once you issue an invoice, even for training, its
issuer, serial, and issue-date identity cannot be deleted and reused; cancel it through the normal
record flow when required.

## Separate operational storage from the legal mode

AEAT's [developer FAQ](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf)
says that local conservation of submitted records is not separately regulated for a Veri*Factu SIF
because AEAT retains them. That does not make a stateless process safe: keep
the assigned numbers, the completed record, chain position, retry state, AEAT response and CSV
durable enough to resume without creating a new identity. You must also conserve complete invoice
documents and anything required by your wider accounting system.

This package does not implement NO Veri*Factu signatures, event records, anomaly reports, operator
identity screens, invoice rendering, or declarations. If your product needs those features, build
and certify them in the deployed SIF rather than treating a valid XML record as proof of the whole
system.

Read the repository's [provenance and disclaimer](https://github.com/waitron-io/verifactu/blob/main/PROVENANCE.md)
before treating any example here as a complete compliance design.
