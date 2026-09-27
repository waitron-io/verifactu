---
title: Submission modes and authority
description: Representative submissions and AEAT requirements use different rules and services.
---

The ordinary [submission walkthrough](/verifactu/en/guides/submit/) uses voluntary Veri*Factu.
Check these distinctions when your taxpayer, certificate holder, or AEAT instruction differs.

Add `Representante: { NombreRazon, NIF }` to `cabecera` only when a representative submits for the
taxpayer. One `Cabecera` may cover records from several SIF installations of the same taxpayer in
one submission, since each record includes its own `SistemaInformatico`. Every alta must repeat
`cabecera.ObligadoEmision.NIF` in `IDEmisorFactura`; the serializer stops before sending if they
differ.

That XML field does not grant authority to act for the taxpayer. Your deployment must separately
hold the applicable social-collaboration agreement and the taxpayer's authorization, and use a
certificate AEAT accepts for that representation. For a software provider using the social-
collaboration route described by the public FAQ, confirm the current Type 017 census procedure and
retain the signed authorization evidence in the form AEAT accepts. Local NIF validation proves
only the text shape; it does not prove that the agreement or authority is active.

For an ordinary voluntary Veri*Factu submission, leave the header's remittance blocks absent.
You can add `RemisionVoluntaria: { FechaFinVeriFactu, Incidencia }` when those fields apply. If
you are submitting non-verifiable records because AEAT required them, use
`RemisionRequerimiento: { RefRequerimiento, FinRequerimiento }` instead; the reference is required.
The blocks cannot be combined. AEAT keeps under-requirement submissions in a separate service:
select `SOAP_ENDPOINTS_REQUERIMIENTO` or `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO` for its client, never
the voluntary `SOAP_ENDPOINTS` pair shown below. Consulta is only available for voluntary
Veri*Factu submissions. This library represents the request XML but does not determine your SIF's
operating mode or confirm that AEAT issued the reference.

The linked walkthrough builds new records for voluntary Veri*Factu. For a requirement,
submit the records already preserved by your SIF rather than rebuilding or changing their
business data to satisfy `assertValid`. AEAT treats business-rule errors in those preserved
records as admissible, except that NIF or `IDOtro` identity errors can still reject them. Read
each result, but do not correct business-rule errors in the preserved records. On your final
batch, set `FinRequerimiento: "S"` in `RemisionRequerimiento`, including when the requirement
takes only one batch. You cannot query these records through the voluntary consulta service.

A Veri*Factu SIF sends each alta at invoice issue. Do not issue invoices in a disconnected system
and copy their records to another system for an end-of-day submission. If two locations operate as
separate SIFs, each one owns its own direct submission path and chain.

The serializer checks the issuer's and representative's NIF form before sending. It also checks
the requirement reference's 18-character limit and a supplied `FechaFinVeriFactu`: its year must
be the current or preceding year, and from 1 January 2027 its date must be `31-12-20XX`. AEAT
uses its own clock and registration records, so its response remains authoritative. A batch may
contain 1–1000 separate wrappers, each holding one alta or one cancellation. The parser rejects
malformed wrappers too.
