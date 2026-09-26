# Veri*Factu compliance audit

This is the working record for checking this library against AEAT's published rules. A passing
local test confirms the stated library behaviour; only AEAT can confirm that a submitted record
is accepted. The [source watch](sources/README.md) checks for publication changes each week.

## Sources checked through 26 September 2026

| AEAT publication                                                                                                                                                   | Version                                    | Audit status                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [Validation rules and errors](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf)          | 1.2.2, 8 April 2026                        | §§3.1.1–3.1.5 map to executable evidence or named AEAT, legal, or live limits; §§4–6 offline inventory complete       |
| [Validation error-code list](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties)                    | Unversioned; modified 30 July 2026         | Three response categories and dispositions mapped; complete fingerprint watched; per-code live precedence not claimed |
| [Web service description](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf)             | 1.0.3, 28 July 2025                        | §§1–11 offline inventory complete; remaining limits are named below                                                   |
| [Hash specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf) | 0.1.2, 27 August 2024                      | §§1–7 offline inventory complete; event records out of scope; decimal-variant comparison pending AEAT preproduction   |
| [QR specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf)               | 0.5.0, 10 December 2025                    | §§1–12 offline inventory complete; print layout and most lookup-response behavior remain outside the public library   |
| [Developer FAQ](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf)                              | 1.3, 4 December 2025                       | Complete inventory; entries 1–15 audited below, entries 16–27 and 29 pending                                          |
| [Public FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html)                                 | Pages listed by AEAT on 22 September 2026  | Pending entry-by-entry review                                                                                         |
| [XSD and WSDL files](schemas/README.md)                                                                                                                            | Versions and checksums in the linked index | Offline closure complete for all five XSD inventories, the WSDL graph, and their cross-schema links                   |

## Official-document closure map

The offline technical audit is complete for the sources below. Complete means that every numbered
section or schema family points to executable repository evidence or to a named boundary that this
package cannot establish locally. It does not mean that AEAT has accepted every possible record,
certificate, or workflow.

| Source scope                            | Evidence in this ledger                                                                                                                                                                           | Boundary that remains external                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Validation §§1–2                        | The source table pins version 1.2.2 and the tax-code section records its legal-reference-only revision                                                                                            | Publication changes remain watched                                                                                                 |
| Validation §3 and §§3.1.1–3.1.5         | The rule table, submission-envelope inventory, cancellation-generator section, and hash section account for every numbered rule group; structural checks cross-reference the five XSD inventories | AEAT registrations, authorization, clock tolerance, legal qualification, and live validation precedence                            |
| Validation §§4–6                        | The response-policy section, tax-code meanings, and both correction-state matrices account for every status, policy group, legal meaning, and annex state                                         | The caller chooses the legally appropriate correction workflow; AEAT decides unassigned response codes and live state              |
| Validation error-code list              | The three response categories are mapped below, representative parser and fake-transport behavior is tested, and the complete source fingerprint is watched                                       | The package preserves unfamiliar codes; it does not simulate the meaning or precedence of every rejection code                     |
| Service description §§1–11              | The coverage map and E9–E12 inventories account for every revision, diagram, field table, annex, and worked flow                                                                                  | Certificates, network behavior, authorization, live ordering, and service acceptance                                               |
| Hash specification §§1–7                | The E13 inventory covers both supported record shapes and all three published vectors                                                                                                             | Event-record hashing is outside this package; decimal lexical equivalence needs a controlled preproduction check                   |
| QR specification §§1–12 and annexes a–l | The E13 inventory covers Veri*Factu URL construction, published vectors, response families, and every printed layout                                                                              | Non-Veri*Factu URLs, general lookup-response handling, and physical render-and-scan checks belong to consumers or live integration |
| Five XSDs and the WSDL                  | E2–E7 account for every schema family, all six global elements, imports, messages, operation edges, bindings, and eight ports                                                                     | Arbitrary incoming XML, signatures, certificate eligibility, and live acceptance are not proved by generated-fixture validation    |

## Developer FAQ coverage map

The watched 52-page developer FAQ remains version 1.3 dated 4 December 2025, with SHA-256
`73906dc8afbbb9da35f6cb489980352b42aed66d48828fd62a00168883c09d5e`. Every page was extracted
and the complete table of contents was checked on 26 September 2026. The live source watch matched
the pinned fingerprint.

Version 1.3 contains entries 1–27 and 29. Its revision history says version 1.1 removed entry 28
and folded it into entry 17, so the missing number is intentional rather than an inventory gap.
E15 checks the first numbered half, entries 1–15; E16 owns the rest.

| Entry | Subject                                                     | Audit state                    |
| ----: | ----------------------------------------------------------- | ------------------------------ |
|     1 | Transitional period                                         | E15 complete                   |
|     2 | When an adapted SIF may start being used                    | E15 complete                   |
|     3 | One SIF product versus a product family                     | E15 complete                   |
|     4 | SIF, installation, and multi-invoicing identification       | E15 complete                   |
|     5 | Multi-component SIF architectures                           | E15 complete                   |
|     6 | Prohibition on duplicate record numbering                   | E15 complete                   |
|     7 | User identification display in a multi-user SIF             | E15 complete                   |
|     8 | Input product plus shared submission-service certification  | E15 complete                   |
|     9 | Software customisation                                      | E15 complete                   |
|    10 | Importing invoices from another system                      | E15 complete                   |
|    11 | Drafts, proformas, delivery notes, and test invoices        | E15 complete                   |
|    12 | Vending machines and RRSIF                                  | E15 complete                   |
|    13 | Record conservation in Veri*Factu and VAT books             | E15 complete                   |
|    14 | Manufacturer responsibility when marketing adapted products | E15 complete                   |
|    15 | Automatic chain checks performed by a SIF                   | E15 complete                   |
|    16 | Software-company representation of invoice issuers          | E16 pending                    |
|    17 | Corrections, cancellations, and rectifications              | E16 pending                    |
|    18 | Responding to requests for non-Veri*Factu records           | E16 pending                    |
|    19 | Rebates and rectification                                   | E16 pending                    |
|    20 | Meaning of total amount in a record                         | E16 pending                    |
|    21 | TicketBAI L13 non-subjection equivalence                    | E16 pending                    |
|    22 | Lottery-ticket sales                                        | E16 pending                    |
|    23 | Record breakdown for supplies located in the Canary Islands | E16 pending                    |
|    24 | Cash accounting and Veri*Factu                              | E16 pending                    |
|    25 | SII-IGIC exemption list L10                                 | E16 pending                    |
|    26 | Invoice content for VAT, IGIC, or IPSI                      | E16 pending                    |
|    27 | Invoices replacing simplified invoices                      | E16 pending                    |
|    28 | Removed in v1.1 and folded into entry 17                    | Accounted for; review with E16 |
|    29 | VAT pending-accrual codes 14 and 15                         | E16 pending                    |

### Developer FAQ entries 1–15 (E15)

| Entry | Package behavior or evidence                                                                                                                                                                                                                                                                | Boundary or later-source disposition                                                                                                                                                                                                                                                                                                                                                                         |
| ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|     1 | No API depends on an adoption deadline. The source watcher pins the FAQ that records the 1 January and 1 July 2027 dates.                                                                                                                                                                   | Transitional dates, contract treatment, and whether a taxpayer is in scope are legal and commercial decisions, not record-protocol behavior.                                                                                                                                                                                                                                                                 |
|     2 | Production and preproduction submission, consulta, and QR endpoints are pinned in `src/endpoints.test.ts`; the injected transport can use them whenever the caller is authorised.                                                                                                           | The package neither decides when a business may adopt a SIF nor queues records around service availability. The FAQ's production-availability statement and certificate eligibility remain live checks.                                                                                                                                                                                                      |
|     3 | `SistemaInformatico` carries the selected product identity and capabilities in every record; the builder preserves the caller's values.                                                                                                                                                     | A deployment must make its regulatory mode and product selection persistent rather than switch per invoice or session. Product-family classification and declarations are legal/deployment responsibilities.                                                                                                                                                                                                 |
|     4 | Public types, `validate`, XML round trips, and XSD tests cover producer identity, the two-character `IdSistemaInformatico`, `Version`, `NumeroInstalacion`, both capability flags, and `IndicadorMultiplesOT`.                                                                              | The caller must allocate a `NumeroInstalacion` that is never reused for the taxpayer and calculate `IndicadorMultiplesOT` per SaaS user: `S` when that user has more than one invoicing operation, including inactive ones. The package cannot infer installation history or tenancy from a record.                                                                                                          |
|     5 | The package is deliberately stateless, accepts caller-supplied record data, injects certificate transport, and preserves record order through `submitRecords`; `src/facade.test.ts` covers that boundary.                                                                                   | Component coordination, simultaneous invoice/record creation, declarations, qualified-certificate authority, NO Veri*Factu signatures, immutable storage, and event records belong to the deployed SIF. This package builds Veri*Factu records and does not certify a multi-component architecture.                                                                                                          |
|     6 | The fake AEAT keys a record by issuer NIF, invoice serial, and issue date, and its duplicate tests prove that cancellation does not make that identity reusable. The submission guide already treats code 3000 as reconciliation, never permission to renumber or recreate a record.        | Invoice-number allocation and permanent uniqueness belong in the caller's durable transaction. A test or training invoice that was issued is a real identity and must not be deleted and reused.                                                                                                                                                                                                             |
|     7 | None; this package has no operator interface or user-session model.                                                                                                                                                                                                                         | Displaying an intelligible, unique taxpayer identity and indicating that a SIF manages multiple taxpayers are host-application UI duties.                                                                                                                                                                                                                                                                    |
|     8 | The shared submission client and injected transport can be composed into a larger product without hiding their version from the caller.                                                                                                                                                     | Whether a shared service is an inseparable component, which declaration covers it, and when product/component versions must change are manufacturer certification decisions.                                                                                                                                                                                                                                 |
|     9 | `buildQrPayload` always returns the required Veri*Factu URL; it does not render or optionally suppress a QR. Record construction and validation are independent of application customisation.                                                                                               | A manufacturer decides whether a customisation changes regulated functionality and therefore needs a declaration/version. Invoice placement remains the renderer's responsibility; allowing the user to omit a required QR is outside the package and not compliant evidence.                                                                                                                                |
|    10 | `parseEnvio` and `serializeEnvio` preserve the originating `SistemaInformatico`, and their round-trip tests cover several installations in one request.                                                                                                                                     | Imported invoices and records must stay attributable to their original SIF and must not be reprinted or resubmitted as records made by this SIF. Storage, segregation, inspection access, and delegated-issuance responsibility belong to the consuming business application.                                                                                                                                |
|    11 | No draft or proforma API emits a fiscal record. A record exists only when the caller invokes a builder; the facade requires the caller's chosen invoice identity and predecessor. Existing duplicate tests cover issued/test identities exactly like any other identity.                    | The host system owns draft, proforma, delivery-note, and training workflows and any broader retention duty. Once it finalises an invoice, it must treat the invoice and record as real; test invoices use distinct numbering and are cancelled rather than deleted or reused.                                                                                                                                |
|    12 | The record, hash, and QR-payload helpers are device-neutral.                                                                                                                                                                                                                                | Whether a vending operation is in RRSIF scope, an SII exclusion, invoice printing, physical QR presentation, and any special billing authorisation belong to the operator and invoice renderer.                                                                                                                                                                                                              |
|    13 | The client returns AEAT responses and CSV data for the caller to store, and consulta can retrieve records supported by the service.                                                                                                                                                         | The FAQ says local conservation of submitted RFs is not separately regulated for a Veri*Factu SIF because AEAT retains them. The caller still needs durable numbers, chain/retry state and receipts to operate safely, and must conserve complete invoice documents and any records required by its wider accounting system.                                                                                 |
|    14 | None; the package has no customer contract, maintenance, sales, or support model.                                                                                                                                                                                                           | Support for non-invoicing modules, notices to customers, refusal to update, and manufacturer/user liability are legal and commercial matters.                                                                                                                                                                                                                                                                |
|    15 | `buildAlta` refuses an omitted predecessor; builders compute the current record's huella; `validate` checks that huella, the predecessor pointer's shape/hash format, and the current record's future timestamp. Focused facade, huella, and validation tests cover those local guarantees. | A single record cannot prove that its stored predecessor was correctly chained to the record before it or compare the predecessor's generation time with the next append. The caller must perform those history checks before its durable append. NO Veri*Factu event logging, anomaly reports, clock control, and the rule to continue invoicing after recording a detected error are outside this package. |

## Web-service description coverage map

This map closes the offline coverage ledger for the library's supported surface. The limits in each
row identify consumer-owned, legal, and authorised live checks. They are not unreviewed publication
sections.

| Section                                                        | Checked here or in earlier branches                                                                                                                | Still to check                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| §§1–2: introduction and revision history                       | Complete offline inventory below: every 0.1.0–1.0.3 revision note is mapped to code, schema evidence, or a named limit                             | None; publication changes remain watched                                                               |
| §3: operating model                                            | Complete offline inventory below: synchronous processing, mixed record batches, statuses, CSV behavior, modes, corrections, and 1,000-record limit | Live acceptance and exact validation precedence                                                        |
| §§4–5: standards, transport, faults                            | Complete offline inventory below: SOAP 1.1 document/literal, UTF-8, HTTPS, caller-owned certificates, and all four fault-table outcomes            | Real certificate authorization, network failure, and live transport acceptance                         |
| §§6.1–6.6: messages, consultation, response, code lists, modes | Complete offline inventory below: every diagram, field-table row, pagination rule, code-list entry, and mode distinction is accounted for          | Live authorization, presentation-order behavior, response-detail performance, and two source conflicts |
| §§6.7–6.9: text and numeric XML                                | Complete offline inventory below: edge-space handling, numeric lexical rules, date exception, escaping, and parser preservation are covered        | AEAT's exact Unicode trim boundary needs a controlled live probe                                       |
| §§7–8: test and production annexes                             | Complete offline inventory below: all 12 published WSDL/XSD links are watched, and their six global elements are mapped to consumers               | Certificate authorization and live service behavior                                                    |
| §§9–11: worked operating flows                                 | Complete offline inventory below: every voluntary, requirement and consulta example is mapped to behavior, executable evidence, or a named limit   | Live state transitions, requirement-service severity, response ordering, and authorization             |

### Service model and transport — service description §§1–5 (E9)

The watched 101-page PDF remains version 1.0.3 dated 28 July 2025, with SHA-256
`b3570f6a308ce98a5f52001a0dc427310ad6cf7bccd60a9ee98720a59e553c02`. Pages 1–2 and
7–15 were extracted and rendered for this inventory; the live source watch matched every pinned
fingerprint on 26 September 2026.

Every revision note in §2 is accounted for:

| Revision    | Published change                                                                                           | Repository evidence or limit                                                                                                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1.0       | Initial document                                                                                           | Historical baseline; no behavior to reconcile independently of later revisions                                                                                                                                                                                                                                            |
| 0.2.0–0.3.0 | Input schemas, Veri*Factu operation, one shared record shape, and mixed alta/anulación batches             | The pinned `SuministroLR.xsd` imports the shared record schema; `EnvioRegistro`, `serializeEnvio`, and `parseEnvio` preserve mixed batches and the 1–1,000 wrapper range in serializer, parser, and XSD tests                                                                                                             |
| 0.4.0       | Duplicate detail, `Representante`, `FinRequerimiento`, and four tax families                               | The response parser/fake expose `RegistroDuplicado`; both request boundaries preserve the representative and requirement fields; public record types, validation, and XML tests cover IVA, IPSI, IGIC, and `Otros`                                                                                                        |
| 0.4.1       | Response `Operacion` block                                                                                 | `parseRespuestaSuministro` preserves its four fields and the fake emits it in schema order; parser, fake, and response-XSD tests cover all published codes                                                                                                                                                                |
| 0.4.2       | Corrected request namespaces and offset-bearing `TimestampPresentacion`                                    | Exact serializer and WSDL tests pin the imported namespaces; response parsing preserves the timestamp literal while the watched response XSD checks XML Schema `dateTime`                                                                                                                                                 |
| 1.0.0       | Under-requirement service, issuer/recipient consulta, optional response detail, and `RefExterna` filtering | Separate endpoint constants, header unions, consulta request/response types, serializers, parsers, fake behavior, and bilingual guides cover the supported offline shape. Requirement validity, certificate authority, response-detail performance, and live query authorization remain AEAT checks                       |
| 1.0.1       | Production URLs                                                                                            | `SOAP_ENDPOINTS*` and `src/endpoints.test.ts` pin all eight voluntary/requirement and ordinary/sello production and preproduction URLs from the WSDL                                                                                                                                                                      |
| 1.0.2       | Partial SIF filter                                                                                         | `SistemaInformaticoConsulta` makes only the identity choice, system ID, and installation number mandatory; request-boundary and XSD tests cover the partial and maximal forms                                                                                                                                             |
| 1.0.3       | Size erratum for `IdPeticionRegistroDuplicado`                                                             | The revision history does not state a replacement length. The current watched `SuministroInformacion.xsd` still assigns `TextMax20Type`, and the response-XSD suite proves 20 accepted and 21 rejected. The final `100` in the revision table is in its `Páginas` column, so it is not evidence for a 100-character limit |

Section 3's operating model is represented without adding orchestration to this stateless library.
`serializeEnvio` produces one synchronous request that may mix altas and cancellations and rejects
zero or more than 1,000 wrappers. `createClient` waits for the HTTP response before parsing it. The
response boundary keeps the global `Correcto`, `ParcialmenteCorrecto`, or `Incorrecto` value and
every line's independent `Correcto`, `AceptadoConErrores`, or `Incorrecto` value. The fake's batch
matrix proves complete, partial, accepted-with-errors, and complete-rejection outcomes, including
the published absence of `CSV` when every line is rejected. A structural or header rejection can
instead be a SOAP fault. Voluntary correction and under-requirement preservation are caller
workflows documented in both submission guides; the library cannot decide whether a rectificativa,
cancellation, or subsanación is legally appropriate.

Sections 4–5 require UTF-8 XML over HTTPS using SOAP 1.1 document/literal and a qualified client
certificate. The serializers emit an explicit UTF-8 declaration and SOAP 1.1 envelope; the client
posts `text/xml; charset=utf-8` with the WSDL's empty `SOAPAction`. The injected `fetch` owns HTTPS
and mTLS, so the package never reads certificate material. `createClient` detects a SOAP `Fault`
before the HTTP-status check and includes the HTTP status, `faultcode`, and `faultstring` in its
error. It does not retry: the caller resends the unchanged message after a `Server` fault, stalled
transport, or unexpected response, but fixes a `Client` fault before resending. That preserves the
document's four client outcomes without risking an automatic duplicate submission. Existing client,
serializer, WSDL, and bilingual guide checks cover this offline contract. Certificate eligibility,
AEAT's centralized NIF lookup, TLS negotiation, actual network failures, and live service acceptance
remain preproduction evidence and were not claimed by this audit.

### Message and field inventory — service description §§6.1–6.6 (E10)

The live 101-page version 1.0.3 PDF still has SHA-256
`b3570f6a308ce98a5f52001a0dc427310ad6cf7bccd60a9ee98720a59e553c02`. Pages 16–45 were extracted,
and the diagrams on pages 17–27 were rendered and inspected on 26 September 2026. The source watch
matched every pinned fingerprint. This inventory compares the publication with the newer watched
XSD/WSDL graph where they differ; it does not treat an older diagram or table as authority to
weaken the current schema checks.

The message diagrams and cross-references are all accounted for:

| Section or diagram                       | Library path and executable evidence                                                                                                                                                                                                   | Limit or disposition                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §6.1 SOAP request and response envelopes | `serializeEnvio` and `serializeConsulta` emit SOAP 1.1 `Envelope`/`Body`; `createClient` sends those bodies and the two response parsers select their matching response roots. Exact serializer and client tests cover both operations | Namespace/import and transport details are closed by the WSDL inventory; live SOAP acceptance remains external                                                     |
| §§6.2.1–6.2.2 submission request         | `Cabecera`, `EnvioRegistro`, the two record types, both request boundaries, and the `SuministroLR.xsd`/`SuministroInformacion.xsd` probes cover every node, choice, sequence, and 1–1,000 occurrence shown on pages 17–21              | Generated requests are unsigned. The optional `ds:Signature` branch needs an external signer and verifier                                                          |
| §6.2.3 consulta request                  | `CabeceraConsulta`, `ConsultaFiltro`, `serializeConsulta`, `parseConsulta`, and the completed `ConsultaLR.xsd` inventory cover every page-23 branch                                                                                    | The library cannot prove that the certificate may query the named issuer or recipient                                                                              |
| §§6.2.4–6.2.5 submission response        | `parseRespuestaSuministro`, the fake AEAT, and response-XSD probes cover the page-25 tree and zero to 1,000 response lines                                                                                                             | The parser deliberately keeps unfamiliar/missing statuses and an absent `Operacion` diagnosable instead of acting as a whole-response XSD validator                |
| §6.2.6 consulta response                 | `parseRespuestaConsulta`, the fake AEAT, and response-XSD probes cover the page-27 tree, including the optional presentation block, stored-record state, lists, and cursor                                                             | The parser projects the returned records but does not expose the echoed header/period or recursively type every stored-record field                                |
| §6.2 SOAP fault example                  | `createClient` detects SOAP faults before HTTP status handling and preserves status, `faultcode`, and `faultstring`; focused client tests cover the published shape                                                                    | AEAT's optional diagnostic `detail` is not typed, and exact live fault precedence remains external                                                                 |
| §6.3 functional submission rules         | The linked validation publication is tracked separately: §§4–6 are complete and the implemented §3.1 rules have code/test receipts in this ledger                                                                                      | This cross-reference contains no independent message field. Unchecked legal/business rules remain named in the validation coverage rather than being inferred here |

The consultation field tables and pagination rules are represented as follows:

| Published field or rule                                  | Library behavior and evidence                                                                                                                                                                                                                                                                                                       | Limit                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Cabecera.IDVersion`                                     | Both request boundaries require the sole literal `1.0`; serializer, parser, and XSD tests cover missing, repeated, and unfamiliar values                                                                                                                                                                                            | None offline                                                                                                                       |
| `ObligadoEmision` or `Destinatario`                      | `CabeceraConsulta` is an exclusive union; both boundaries check the 120-code-point name and nine-code-point NIF bounds                                                                                                                                                                                                              | NIF registration and query authority require AEAT                                                                                  |
| `IndicadorRepresentante`                                 | Only literal `S` is accepted, only with `ObligadoEmision`; request tests cover `N`, whitespace, recipient misuse, and the valid round trip                                                                                                                                                                                          | The library cannot prove representation authority                                                                                  |
| `PeriodoImputacion`                                      | `ConsultaFiltro` requires a four-digit year and one of `01`–`12`. The fake now filters an alta on `FechaOperacion`, falling back to `FechaExpedicionFactura`; an accepted cancellation keeps the alta period or uses the cancelled invoice's issue period when no alta is stored. Red/green integration tests cover all three paths | AEAT alone proves how corrected historical data is assigned and ordered in its store                                               |
| `NumSerieFactura`                                        | Optional 1–60-code-point filter preserved by both request boundaries                                                                                                                                                                                                                                                                | Matching semantics require the live service                                                                                        |
| `Contraparte`                                            | Optional name plus exclusive NIF/`IDOtro` identity, including country/type/ID bounds, is covered by serializer, parser, fake, and XSD tests for issuer- and recipient-side queries                                                                                                                                                  | Identity registration remains external                                                                                             |
| exact `FechaExpedicionFactura` or `RangoFechaExpedicion` | Public type and both boundaries enforce the exclusive branch and date shape; fake tests cover exact and inclusive-range filtering                                                                                                                                                                                                   | The XSD allows an empty range and does not establish calendar validity                                                             |
| `SistemaInformatico`                                     | `SistemaInformaticoConsulta` requires producer identity, system ID, and installation number while preserving all optional fields; request and fake tests cover Spanish/foreign identities and partial/maximal filters                                                                                                               | Live matching and authorization remain external                                                                                    |
| `RefExterna`                                             | Optional 0–60-code-point filter is serialized, parsed, and exercised by the fake                                                                                                                                                                                                                                                    | Empty text is schema-valid; whether it is useful to AEAT is unverified                                                             |
| request `ClavePaginacion`                                | The three-field identity is checked with the same NIF, serial-number, and date bounds as an invoice identity and serialized in schema order                                                                                                                                                                                         | A stale live cursor's recovery behavior is not published; the fake restarts its filtered sweep                                     |
| `MostrarNombreRazonEmisor`                               | Optional `S`/`N` flag controls the fake's projected issuer name; omission behaves as `N`                                                                                                                                                                                                                                            | The published extra response time is an AEAT performance claim, not measurable offline                                             |
| `MostrarSistemaInformatico`                              | Optional `S`/`N` flag controls the fake's projected software block and must be `N` or omitted for recipient-side queries                                                                                                                                                                                                            | The published extra response time and live redaction remain external                                                               |
| echoed response header and `PeriodoImputacion`           | The fake emits both in XSD order and the response fixture validates them; `parseRespuestaConsulta` intentionally omits them from its result                                                                                                                                                                                         | Capture raw XML if an integration needs to reconcile the echo                                                                      |
| `IndicadorPaginacion` and `ResultadoConsulta`            | Parser accepts only `S`/`N` and `ConDatos`/`SinDatos`; focused tests cover every value, missing/repeated fields, and empty/final pages                                                                                                                                                                                              | None offline                                                                                                                       |
| up to 10,000 returned records                            | Parser rejects a 10,001st record; XSD probes independently accept 10,000 and reject 10,001                                                                                                                                                                                                                                          | The fake uses a configurable small page size so tests can exercise multiple pages cheaply                                          |
| returned record, presentation, and state blocks          | Parser checks each identity, the optional presentation block, required stored record, last-modified timestamp, three stored states, integer error code, and 500-code-point description. The exported `DatosPresentacionConsulta` type now marks its three parser-required children as required                                      | The stored record body stays a loss-aware projection; live presence of optional fields remains external                            |
| response `ClavePaginacion`                               | Required and validated when the indicator is `S`, absent from the public result on a final `N` page, and safe to echo into the next request                                                                                                                                                                                         | The fake uses insertion order as a presentation-time stand-in; only AEAT can prove its exact ordering and concurrent-page behavior |

The submission response, list values, and operating modes are also closed:

| Published field, list, or mode                                 | Library behavior and evidence                                                                                                                                                                                          | Limit or source conflict                                                                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CSV`                                                          | Parser preserves any text; fake omits it only for a wholly rejected batch, and tests require callers to retain it because consulta cannot recover it                                                                   | The PDF says 16 characters, but the current `RespuestaSuministro.xsd` uses unbounded `xs:string`. The library does not truncate or reject either source's possible value without live evidence   |
| `DatosPresentacion` and echoed `Cabecera`                      | Parser returns the two required presentation fields; fake echoes every header variant and validates against the XSD                                                                                                    | Presenter authorization and timestamp provenance require AEAT; the parser intentionally omits the echoed header                                                                                  |
| `TiempoEsperaEnvio`                                            | Parser accepts usable one-to-four-digit seconds and preserves the raw unusable value; fake returns a value in the same schema domain. Flow-control tests and bilingual guidance use the wait-or-1,000-record condition | The XSD also accepts an empty value, which cannot schedule work; the caller owns its queue and clock                                                                                             |
| `EstadoEnvio` (`L18`)                                          | Known type lists `Correcto`, `ParcialmenteCorrecto`, and `Incorrecto`; parser preserves unfamiliar raw text and fake batch tests cover all three meanings                                                              | Exact live validation precedence remains external                                                                                                                                                |
| line `IDFactura`, `Operacion`, and `RefExterna`                | Parser/fake/tests cover all identity fields, operation order, `Alta`/`Anulacion`, the three optional correction flags, and the 60-code-point reference                                                                 | Parser tolerance for an absent/unfamiliar operation keeps the batch CSV and other line results inspectable                                                                                       |
| line `EstadoRegistro` (`L19`) and error code (`L20`)           | Known states are `Correcto`, `AceptadoConErrores`, and `Incorrecto`; integer error codes and the separately watched current error list are preserved                                                                   | The parser does not infer a correction workflow from a numeric code                                                                                                                              |
| line error description                                         | Current XSD probes accept 1,500 Unicode code points and reject 1,501; parser preserves diagnostic text                                                                                                                 | The PDF table says 500, while the current `RespuestaSuministro.xsd` says 1,500. The nested duplicate description remains 500 in both sources; no 500-character top-level restriction is invented |
| `RegistroDuplicado`, state (`L21`), and operation kind (`L22`) | Parser/fake/XSD tests cover the 20-code-point petition ID, `Correcta`/`AceptadaConErrores`/`Anulada`, nested error detail, and `Alta`/`Anulacion`                                                                      | The parser keeps malformed/future values diagnosable as unknown; consulta may be needed to reconcile an omitted duplicate block                                                                  |
| representative (`L1C`) and month (`L2C`) lists                 | Request types and boundary tests allow only `S` and the twelve zero-padded months respectively                                                                                                                         | None offline                                                                                                                                                                                     |
| voluntary versus under-requirement submission                  | Shared record types/schema are used with separate ordinary/sello endpoints for each mode; WSDL and endpoint tests pin all addresses, and consulta exists only on the voluntary binding                                 | `createClient` accepts a caller-supplied endpoint and cannot prove the chosen mode. The fake has one shared store and does not model AEAT's isolated stores                                      |

No submission, hash-chain, immutable-record, or golden-vector behavior changed in this audit. The
only runtime correction is the fake's imputation-period filtering, and the only public API
correction is making fields already required by the consulta parser non-optional in its response
type.

## Rules checked in this branch

| Rule                                                                                                                                                                     | Library check                                                                                                                                                                                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Limit                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Validation §3.1.3.1: alta issuer NIF equals `Cabecera.ObligadoEmision.NIF`                                                                                               | `serializeEnvio` rejects a mismatched alta before producing XML                                                                                                                                                                                            | Mismatched and matching batch cases in `src/xml/serialize.test.ts`; the package-surface test uses distinct taxpayer and software-producer identities                                                                                                                                                                                                                                                                                                                                                             | AEAT checks that the NIF exists; the library checks equality and local NIF form only                                                                                                                                                                                                 |
| Validation §3.1.3.1: issue-date floor, current-date ceiling, and relation to `FechaOperacion`                                                                            | `FECHA_EXPEDICION_BEFORE_MINIMUM`, `FECHA_EXPEDICION_FUTURE`, and `FECHA_EXPEDICION_BEFORE_OPERACION` errors                                                                                                                                               | Boundary, timezone-offset, IVA/IGIC exception, and other-tax cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                     | A mixed invoice containing both exception and ordinary IVA/IGIC lines is treated conservatively: every applicable line must qualify                                                                                                                                                  |
| Validation §3.1.3.1 and `sf:TextoIDFacturaType`: invoice-number length and characters                                                                                    | `NUMSERIE_LENGTH` enforces 1–60 characters; `NUMSERIE_CHARSET` enforces the library's QR-safe alphabet                                                                                                                                                     | Length boundaries and rejected-character cases in `src/validate.test.ts`; serializer and QR tests cover the accepted alphabet                                                                                                                                                                                                                                                                                                                                                                                    | Deliberately stricter than AEAT: printable ASCII outside letters, digits, `/`, `_`, `.`, and `-` is rejected locally                                                                                                                                                                 |
| Validation §3.1.3.2: `RechazoPrevio` `S` or `X` requires `Subsanacion` `S`                                                                                               | `RECHAZO_PREVIO_REQUIRES_SUBSANACION` in `validate`                                                                                                                                                                                                        | Rejected `S`/`X`, accepted `S`/`X` with subsanación, and independent `N` cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                         | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.3: `TipoRectificativa` is present exactly for `R1`–`R5`                                                                                                | `TIPO_RECTIFICATIVA_REQUIRED` and `TIPO_RECTIFICATIVA_FORBIDDEN` in `validate`                                                                                                                                                                             | Rectificativa and ordinary-invoice cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                               | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.4 and `sf:IDFacturaARType`: `FacturasRectificadas` is non-empty, allowed only for `R1`–`R5`, and its NIFs are identified                               | `FACTURAS_RECTIFICADAS_FORBIDDEN` and `FACTURAS_RECTIFICADAS_EMPTY`; every reference receives local NIF, invoice-number length, and real-date checks                                                                                                       | Allowed, forbidden, empty, indexed malformed-NIF, number-boundary, and invalid-date cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                              | Only AEAT can confirm that a well-formed referenced NIF is registered; the main invoice's QR-safe local alphabet does not apply to references                                                                                                                                        |
| Validation §3.1.3.5 and `sf:IDFacturaARType`: `FacturasSustituidas` is non-empty, allowed only for `F3`, and its NIFs are identified                                     | `FACTURAS_SUSTITUIDAS_FORBIDDEN` and `FACTURAS_SUSTITUIDAS_EMPTY`; every reference receives local NIF, invoice-number length, and real-date checks                                                                                                         | Allowed, forbidden, empty, indexed malformed-NIF, number-boundary, and invalid-date cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                              | Only AEAT can confirm that a well-formed referenced NIF is registered; the main invoice's QR-safe local alphabet does not apply to references                                                                                                                                        |
| Validation §3.1.3.6: `ImporteRectificacion` is present exactly for `TipoRectificativa` `S`                                                                               | `IMPORTE_RECTIFICACION_REQUIRED` and `IMPORTE_RECTIFICACION_FORBIDDEN` in `validate`                                                                                                                                                                       | Required, forbidden, and allowed cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.7: `FechaOperacion` stays within the published 20-year/following-calendar-year window; future IVA/IGIC dates require regime `14` or `15`               | `FECHA_OPERACION_BEFORE_MINIMUM`, `FECHA_OPERACION_AFTER_NEXT_YEAR`, and `FECHA_OPERACION_FUTURE` in `validate`                                                                                                                                            | Lower and upper boundaries, ordinary and exempt IVA/IGIC regimes, mixed lines, and other-tax cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                     | A mixed record is treated conservatively: every applicable IVA or IGIC line must use `14` or `15` for a future operation date                                                                                                                                                        |
| Validation §3.1.3.8: `FacturaSimplificadaArt7273` may be `S` only for `F1`, `F3`, `R1`–`R4`                                                                              | `FACTURA_SIMPLIFICADA_ART_7273_FORBIDDEN` in `validate`                                                                                                                                                                                                    | Every allowed and forbidden invoice family plus the unrestricted `N` value in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.9: `FacturaSinIdentifDestinatarioArt61d` may be `S` only for `F2` or `R5`                                                                              | `FACTURA_SIN_IDENTIF_DESTINATARIO_ART_61D_FORBIDDEN` in `validate`                                                                                                                                                                                         | Every allowed and forbidden invoice family plus the unrestricted `N` value in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.10: `Macrodato` is present when `abs(ImporteTotal) >= 100000000.00`                                                                                    | `MACRODATO_REQUIRED` in `validate`                                                                                                                                                                                                                         | Positive and negative threshold, below-threshold, present-`N`, and malformed-total non-cascade cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                   | The publication requires field presence; the XSD permits both `S` and `N`, so the validator deliberately does not invent a value requirement                                                                                                                                         |
| Validation §3.1.3.11: issuer indicator `T` requires `Tercero`; `D` requires `Destinatarios`                                                                              | `TERCERO_REQUIRED` and `DESTINATARIOS_REQUIRED_BY_ISSUER`; the public types, builder, parser, and serializer carry both official fields                                                                                                                    | Required-block cases in `src/validate.test.ts`; pass-through, hash exclusion, exact XSD order, and NIF/`IDOtro` request round-trip cases in record/XML tests                                                                                                                                                                                                                                                                                                                                                     | Because §3.1.3.13 forbids recipients on `F2`/`R5`, recipient-issued (`D`) records are valid only for invoice types that permit recipients                                                                                                                                            |
| Validation §3.1.3.12 and note (1): `Tercero` appears only with issuer indicator `T` and carries one permitted identity                                                   | `TERCERO_FORBIDDEN`, `TERCERO_ID_CHOICE`, `TERCERO_NIF_EQUALS_EMISOR`, `TERCERO_ES_IDTYPE`, `TERCERO_IDTYPE_07_FORBIDDEN`, local NIF checks, and `TERCERO_VAT_ID_FORMAT`                                                                                   | Missing/both identity branches, Spanish and type-07 restrictions, equal/invalid NIFs, all published EU VAT-number shapes, invalid shapes, and the dated GB/XI transition in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                               | Only AEAT can confirm that a locally well-formed Spanish NIF or EU VAT number is registered                                                                                                                                                                                          |
| Validation §3.1.3.13 and note (1): recipient presence, identity choice, Spanish/`07` restrictions, VAT shape, and invoice-family restriction                             | `DESTINATARIOS_REQUIRED`, `DESTINATARIOS_FORBIDDEN`, `DESTINATARIO_ID_CHOICE`, `DESTINATARIO_IDTYPE_07_COUNTRY`, `DESTINATARIO_ES_IDTYPE`, `DESTINATARIO_VAT_ID_FORMAT`, and `DESTINATARIO_VAT_FACTURA_TYPE` in `validate`                                 | Type-specific presence, missing/both identity, Spanish and type-07 restrictions, valid/invalid VAT-shape, invoice-family, control-character, and local NIF cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                       | Only AEAT can confirm that a locally well-formed Spanish NIF or EU VAT number is registered                                                                                                                                                                                          |
| Validation §3.1.3.14: `Cupon` may be `S` only for `R1` and `R5`                                                                                                          | `CUPON_FORBIDDEN` in `validate`                                                                                                                                                                                                                            | Every allowed and forbidden invoice family plus unrestricted `N` in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                       | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.15.1: IVA `S1` tax rates and the dated windows for `5`, `2`, and `7.5`                                                                                 | `TIPO_IMPOSITIVO_VALUE` and `TIPO_IMPOSITIVO_DATE` in `validate`                                                                                                                                                                                           | Ordinary values, every special-window boundary, issue-date fallback, explicit/implicit IVA, other-tax, and malformed-value/date non-cascade cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                      | Local validation operates on the two-decimal literals produced by the builder                                                                                                                                                                                                        |
| Validation §3.1.3.15.2: `BaseImponibleACoste` only for regime `06`, IPSI, or other tax                                                                                   | `BASE_IMPONIBLE_A_COSTE_FORBIDDEN` plus the shared amount-format check in `validate`                                                                                                                                                                       | Every allowed condition, an ordinary-IVA rejection, and malformed amount syntax in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                        | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.15.3: IVA `S1` equivalence-surcharge values match the tax rate and effective-date window                                                               | `TIPO_RECARGO_COMBINATION` in `validate`                                                                                                                                                                                                                   | Every published allowed pairing/date boundary, wrong pairings, missing/malformed rates, explicit/implicit IVA, other-tax, and malformed-date non-cascade cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                         | The rule is enforced only when `TipoRecargoEquivalencia` is present; regime-specific requirements remain in §15.6                                                                                                                                                                    |
| Validation §3.1.3.15.4: reverse-charge (`S2`) invoice family and zero fields; IVA `N1`/`N2` field exclusions                                                             | `S2_TIPO_FACTURA`, `S2_TIPO_IMPOSITIVO`, `S2_CUOTA_REPERCUTIDA`, and `N1_N2_TAX_FIELDS_FORBIDDEN` in `validate`                                                                                                                                            | Allowed/forbidden families, missing/nonzero S2 fields, every forbidden N1 field, N2, and other-tax scope in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                               | None                                                                                                                                                                                                                                                                                 |
| Validation §3.1.3.15.5–15.5.1: IVA/IGIC exemption lists, regime-01 exclusions, empty tax fields, and IVA `E5` recipient identity                                         | `OPERACION_EXENTA_VALUE`, `OPERACION_EXENTA_REGIMEN`, `OPERACION_EXENTA_TAX_FIELDS_FORBIDDEN`, and `OPERACION_EXENTA_E5_DESTINATARIO_ID` in `validate`                                                                                                     | IVA and IGIC allowed/forbidden codes, ordinary/other regime, clean and polluted exempt lines, other-tax scope, explicit/implicit IVA, absent/mixed recipients, and multi-line E5 cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                 | Exemption values for taxes other than IVA/IGIC remain governed by their schema/code lists                                                                                                                                                                                            |
| Validation §3.1.3.15.6–15.6.11: tax-specific `ClaveRegimen` lists and special conditions for regimes `02`, `03`, `04`, `06`, `07`, `08`, `10`, `11`, `14`, and IGIC `20` | `CLAVE_REGIMEN_REQUIRED`, `CLAVE_REGIMEN_FORBIDDEN`, `CLAVE_REGIMEN_VALUE`, and the `REGIMEN_*` checks in `validate`; missing or invalid IPSI is a warning through 2026 and an error from 2027                                                             | Complete IVA, IPSI, and IGIC code lists; both sides of the IPSI transition; qualification/exemption, invoice-family, base-at-cost, rate, recipient, date-order, mixed-line, duplicate-suppression, and malformed-date cases in `src/validate.test.ts`                                                                                                                                                                                                                                                            | Developer FAQ 1.3 still says IPSI must omit `ClaveRegimen`; the newer validation publication 1.2.2 requires it with the stated transition, so the validator follows the newer rule. The special conditions retain their published tax scopes: `08` IVA/IGIC, `11` IVA, and `20` IGIC |
| Validation §3.1.3.15.7: `S1` rate and charged-tax presence, sign, applicable-base formula, ±€10 tolerance, and correction exceptions                                     | `S1_TIPO_IMPOSITIVO_REQUIRED`, `S1_CUOTA_REPERCUTIDA_REQUIRED`, `S1_CUOTA_REPERCUTIDA_SIGN`, `S1_CUOTA_REPERCUTIDA_FORMULA`, and `CUOTA_REPERCUTIDA_NONZERO_FORBIDDEN` in `validate`; narrower existing issues cover `S2`, IVA `N1`/`N2`, and exempt lines | Required fields across taxes, nonzero and zero non-`S1` cases, both tolerance boundaries, positive/negative/zero signs, standard/base-at-cost selection, `I` and `R2`/`R3` exceptions, an `R4` counterexample, and malformed-input non-cascades in `src/validate.test.ts`                                                                                                                                                                                                                                        | Numeric checks use the same JavaScript-number convention as the existing total validations                                                                                                                                                                                           |
| Validation §3.1.3.15.8: simplified-invoice base-plus-tax cap, +€10 margin, and both published exceptions                                                                 | `F2_AMOUNT_LIMIT` in `validate`; `NumRegistroAcuerdoFacturacion` is supported by the public types, builder, serializer, and request parser                                                                                                                 | Exact upper boundary, aggregate lines, charged-tax inclusion, surcharge exclusion, negative total, non-`F2` scope, both exceptions, malformed-input non-cascade, XSD length, hash exclusion, XML position, and round-trip cases across validation, record, and XML tests                                                                                                                                                                                                                                         | Only AEAT can confirm that a locally well-formed billing-agreement registration number exists                                                                                                                                                                                        |
| Validation §3.1.3.16–17: total cross-checks allow €10 and exclude regimes `03`, `05`, `06`, `08`, `09`                                                                   | `CUOTA_TOTAL_MISMATCH` and `IMPORTE_TOTAL_MISMATCH` warnings, skipped when any line uses an excluded regime                                                                                                                                                | Tolerance boundary, pure-exclusion and mixed-regime cases in `src/validate.test.ts`; conclusive AEAT preproduction runs for [`03`](https://github.com/waitron-io/verifactu/actions/runs/35857557571), [`05`](https://github.com/waitron-io/verifactu/actions/runs/35864290069), [`06`](https://github.com/waitron-io/verifactu/actions/runs/35868064280), [`08`](https://github.com/waitron-io/verifactu/actions/runs/35868173896), and [`09`](https://github.com/waitron-io/verifactu/actions/runs/35864701279) | Each published exclusion code has one live-verified mixed-regime shape; other line shapes remain subject to their own regime rules                                                                                                                                                   |
| Validation §3.1.3.18 and §3.1.4.4: predecessor hash has the 64-character uppercase SHA-256 output format                                                                 | `HUELLA_ANTERIOR_FORMAT` warning in `validate`; `assertValid` does not block the record because AEAT classifies this issue as non-rejecting                                                                                                                | Malformed predecessor hashes on both alta and cancellation records, exact severity, and non-throwing `assertValid` behavior in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                            | The local format check does not prove that the predecessor exists in AEAT or that the submitted chain is otherwise accepted                                                                                                                                                          |
| Validation §3.1.3.19, §3.1.4.5, and §3.1.5: software-system identity and required content                                                                                | `SistemaInformatico` exposes the XSD's exclusive `NIF`/`IDOtro` choice; `validate` checks the producer identity rules, exact two-character uppercase/digit system ID, required software name, and required usage flags for alta and cancellation records   | Type-level exclusivity, XML serialization and round trips, builder pass-through, foreign-system consulta filtering/expansion, VAT/date cases, every local rejection rule, and both record types across `src/types.ts`, `src/records.test.ts`, `src/validate.test.ts`, `src/xml/*.test.ts`, and `src/testing/fake-aeat.test.ts`                                                                                                                                                                                   | Only AEAT can confirm that a locally well-formed NIF or EU VAT identity is registered                                                                                                                                                                                                |
| Validation §3.1.3.20 and §3.1.4.6: generation time no more than the permitted margin ahead of AEAT's system time                                                         | `FECHA_HORA_FUTURE` warning in `validate` for both alta and cancellation records; the one-minute boundary comes from [Order HAC/1177/2024 art. 7(f)](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138&p=20241028&tn=0)                                | Exact one-minute boundary, one-second excess, equivalent instants with different offsets, malformed timestamp suppression, non-throwing `assertValid`, and both record types in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                           | A local clock comparison cannot prove synchronization with AEAT's clock; AEAT's response remains authoritative                                                                                                                                                                       |
| Validation §3.1.3.21–22: supplied billing and software-system agreement identifiers must exist at AEAT                                                                   | `NumRegistroAcuerdoFacturacion` and `IdAcuerdoSistemaInformatico` are optional alta fields; the builder, XML serializer, and parser preserve both. `validate` checks their XSD maximum lengths of 15 and 16 characters and rejects XML control characters. | Builder and hash exclusion in `src/records.test.ts`; exact XSD order, XML output, and round trip in `src/xml/*.test.ts`; both length boundaries and control characters in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                 | The library has no AEAT agreement registry. Local validation cannot confirm either ID exists; inspect AEAT's per-record response.                                                                                                                                                    |
| Hash specification examples                                                                                                                                              | Canonicalization and `computeHuella` match three published examples                                                                                                                                                                                        | `src/upstream-conformance.test.ts`, fixtures in `test/upstream/`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The fixtures are packaged by a third party; AEAT's PDF is authoritative                                                                                                                                                                                                              |
| QR specification examples                                                                                                                                                | QR URL helper matches three supported published examples                                                                                                                                                                                                   | `src/upstream-conformance.test.ts`, fixtures in `test/upstream/`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Further QR cases and rendering details remain to be audited                                                                                                                                                                                                                          |

### Filing correction and cancellation enums — `SuministroInformacion.xsd`

The alta XSD permits `Subsanacion` `S`/`N`, `RechazoPrevio` `N`/`S`/`X`, `TipoFactura`
`F1`–`F3`/`R1`–`R5`, `TipoRectificativa` `S`/`I`, and
`EmitidaPorTerceroODestinatario` `D`/`T`. Cancellation
`SinRegistroPrevio` and `RechazoPrevio` permit only `S`/`N`, while `GeneradoPor` permits
`E`/`D`/`T`. The public TypeScript types already express these choices, but JavaScript callers
could previously pass other values through `validate` and `serializeEnvio`. Both boundaries now
report the invalid field before XML submission. The required `TipoFactura` also rejects an
undefined value from an untyped caller. Focused invalid-value tests and offline XSD
mutations cover every value, including cancellation `RechazoPrevio: "X"` versus the valid alta
value. This is lexical XSD checking; existing business rules for valid combinations still apply.
An untyped object missing the `TipoFactura` key entirely is a separate shape problem because
`isAlta` uses that key to distinguish record kinds; `validate` can therefore throw before returning
issues for that malformed shape. This branch does not change the discriminator or claim to make
arbitrary untyped record shapes safe.

### Filing record field inventory — `SuministroInformacion.xsd` (E2)

The pinned `RegistroFacturacionAltaType` and `RegistroFacturacionAnulacionType` sequences were
compared field by field with `RegistroAlta`/`RegistroAnulacion`, both builders, `validate`,
`serializeEnvio`, and `parseEnvio`. The public types and builders remain the compile-time source
for required fields. A shared runtime guard now protects both XML boundaries, so direct JavaScript
objects and parsed request XML receive the same field-qualified XSD checks before the library
returns or sends a filing record.

| Field family                             | Public type, builder, and structured validation                                                                                                                                                                                              | Serializer/parser boundary and evidence                                                                                                                                                                                                                             | Deliberate limit or stricter policy                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record discriminators and list order     | Required alta/cancellation fields are explicit in `src/types.ts`; the builders construct their respective record shape                                                                                                                       | The serializer emits every supported element in the XSD sequence; request round trips and exact-XML tests pin that order                                                                                                                                            | `parseEnvio` is a projection and does not reject arbitrary unknown, repeated, or reordered ordinary elements. Validate untrusted XML against the pinned XSD when that distinction matters. The optional `ds:Signature` is not exposed or produced; this library emits unsigned request records. |
| Invoice identities and dates             | Builders format issue dates; `validate` checks NIF control, real dates, and the library's narrower invoice-number alphabet                                                                                                                   | The shared guard checks nine-code-point NIFs, `DD-MM-YYYY` lexical shape, and the 1–60 or 0–60 invoice-number limits on main, referenced, and predecessor identities; serializer/parser tests and offline XSD mutations cover each shape                            | XSD `fecha` checks shape, not calendar reality. Structured validation is deliberately stricter and uses ASCII dates plus real-calendar checks. AEAT alone confirms identity registration.                                                                                                       |
| Literal codes                            | Type unions cover version, correction/cancellation flags, invoice kind, issuer kind, software flags, hash type, tax, regime, qualification, and exemption values; `validate` returns `XSD_ENUM_VALUE` where no narrower business code exists | The shared guard rejects out-of-domain literals at serialization and parsing; focused tests plus `xmllint` mutations cover alta, cancellation, software, and detail families                                                                                        | Lexical membership does not prove that a valid combination satisfies AEAT's business rules; those remain separate structured validations.                                                                                                                                                       |
| Text maxima                              | Builders preserve text; `validate` retains established codes for description, software name, agreement IDs, IDOtro, and hash fields and uses `XSD_TEXT_LENGTH` for previously unrepresented paths                                            | `RefExterna`, issuer/person/software names, software version/installation, description, agreement IDs, IDOtro, and hashes use Unicode-code-point counts at both XML boundaries; astral-character tests prove exact and one-past limits                              | Required `TextMax*` values may be empty under the XSD unless another published business rule requires content. The validator keeps its stricter required-content and control-character rules.                                                                                                   |
| Exclusive choices                        | `Encadenamiento`, `PersonaFisicaJuridica`, and `DetalleDesglose` use mutually exclusive TypeScript unions                                                                                                                                    | The guard rejects both and neither branches instead of letting the serializer or parser silently choose one; direct, serialization, parsing, and schema tests cover the three choices                                                                               | Business rules can further require or forbid an otherwise schema-valid branch.                                                                                                                                                                                                                  |
| Nested occurrences                       | Types expose arrays; builders preserve caller order; `validate` reports `DESGLOSE_COUNT`, existing empty-wrapper codes, and `XSD_OCCURRENCE`                                                                                                 | The guard enforces 1–12 detail lines and at most 1,000 rectified references, substituted references, and recipients. Boundary tests distinguish 1,000 from 1,001 and the pinned XSD independently agrees                                                            | Empty optional reference/recipient wrappers have existing structured business errors; generated XML is not evidence that AEAT recognizes the referenced invoice.                                                                                                                                |
| Amounts and rates                        | Builders emit exact ASCII decimals with two fractional digits; `validate` rejects leading `+`, leading zeroes, missing fractional digits, and later business inconsistencies                                                                 | The shared guard accepts the XSD's wider `ImporteSgn12.2Type` and `Tipo2.2Type` lexical spaces for totals, correction amounts, and every detail amount/rate, while rejecting schema-invalid direct or parsed values; offline mutations cover both patterns          | The builder/validator two-decimal policy is intentionally stricter than XSD. XSD `\d` includes Unicode decimal digits, which the boundary accepts; generated records use ASCII.                                                                                                                 |
| Generation timestamp                     | Builders emit a numeric-offset timestamp; `validate` applies the library's exact shape, calendar validity, offset bound, and future-clock warning                                                                                            | The shared guard rejects malformed XML Schema `dateTime` values for both record kinds and accepts the operational positive-year subset, including valid fractional seconds, `Z`, an offset, or no zone; serializer/parser tests and an XSD mutation cover rejection | The filing API's validator remains stricter than the base XSD, and only AEAT's clock can decide the published future-time rule.                                                                                                                                                                 |
| XML order and unsupported schema content | Every supported filing field is represented in the record types and builders                                                                                                                                                                 | Exact serializer tests and generated-body XSD validation prove the emitted order; the pinned schema and checksum remain unchanged                                                                                                                                   | Incoming element-order validation and the optional XML signature belong to full-schema validation, not the request projection. Filing envelopes are audited separately in E3.                                                                                                                   |

This inventory is offline evidence against the watched schema file, not a live AEAT acceptance
claim. `schemas/README.md` remains the checksum authority, and the source-watch test detects a
publication change that would require this table to be revisited.

One compatibility change is intentional: through 2026, an IPSI `ClaveRegimen` outside the
tax-specific business list still retains its existing advisory `CLAVE_REGIMEN_VALUE`, but a
literal such as `99` now also receives blocking `XSD_ENUM_VALUE` because the pinned schema rejects
it in every period. A missing IPSI regime keeps the existing advisory-only behavior until 2027.

### Cancellation generator — validation §3.1.4.1–3

`serializeEnvio` requires `RegistroAnulacion.IDFactura.IDEmisorFacturaAnulada` to match
`Cabecera.ObligadoEmision.NIF` for every `GeneradoPor` value. The cancellation builder, XML
serializer, and request parser preserve the optional `GeneradoPor`/`Generador` pair; neither
field enters the hash. `validate` requires both fields together, exactly one generator identity,
a distinct and locally valid NIF, a NIF for `E`, the published Spanish `IDOtro` combinations for
`D`/`T`, no `07` for `T`, and the published EU VAT-number shape for `IDType: "02"`.
`src/records.test.ts`, `src/xml/*.test.ts`, and `src/validate.test.ts` cover these paths,
including XML order, round trips, and exact issue details. AEAT alone can confirm that a NIF or
EU VAT identity is registered.

### Tax-code meanings — validation §§5.1–5.2

The clarification glossary distinguishes `N1` (not subject under the applicable tax's
non-taxation provisions) from `N2` (not subject because of place-of-supply rules) for IVA,
IGIC, and IPSI. It maps exemption codes to different legal provisions for each tax: `E1`–`E6`
for IVA and IPSI, and `E1`–`E8` for IGIC. `validate` checks the IVA and IGIC exemption-code
lists and their published combinations, but it cannot determine whether a transaction legally
qualifies for any classification. Validation §3.1.3.15.5 specifies the IVA/IGIC list checks;
it does not impose an equivalent local IPSI list check. The English and Spanish validation
guides now explain the choice and this limit. This is a terminology and guidance audit, not
evidence of an AEAT acceptance result for every tax-code combination.

Version 1.2.2 changed only literal legal references in §5.2.2: IGIC `E1` now cites chapter I and
`E7` article 90 of Decreto Legislativo 1/2025. The code domains and local validation behavior did
not change. The guides record those current meanings without turning legal qualification into a
software assertion.

### Submission header and record wrappers — validation §3.1.1–2

The public `Cabecera` type preserves the optional voluntary-remittance block or the alternative
under-requirement block, including `FechaFinVeriFactu`, `Incidencia`, `RefRequerimiento`, and
`FinRequerimiento`. `serializeEnvio` and `parseEnvio` preserve the XSD order and reject both modes
together as a local mode policy; the shared XSD itself declares two optional fields rather than an
exclusive choice. Absence of both blocks remains the backward-compatible voluntary default; a caller
submitting non-verifiable records under requirement must select that mode explicitly. The library
does not infer the SIF's operating mode or prove that a requirement was issued.

Service description §6.6 and the WSDL declare separate under-requirement URLs and AEAT record
stores. `SOAP_ENDPOINTS_REQUERIMIENTO` and `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO` pin all four
published addresses in `src/endpoints.test.ts`; callers must select one for those submissions,
not a voluntary Veri*Factu endpoint. Consulta is available only on the voluntary service. The
library's generic `createClient` accepts a caller-provided endpoint and cannot establish that the
caller chose the right mode or holds a valid AEAT requirement. The current fake AEAT is a
shared-store transport double; it does not model the separate under-requirement service or its
absence of consulta. Use AEAT preproduction for those integration claims.

### Mode-specific response and correction policy — validation §4.1–3, service description §§3, 10

The response parser preserves each record's `Correcto`, `AceptadoConErrores`, or `Incorrecto`
status and the global status. `resolveEstadoEfectivo` resolves duplicate error 3000 separately;
it does not choose a correction workflow. The English and Spanish submission guides now scope
their `assertValid` gate, correction advice, and consulta example to voluntary Veri*Factu.
Validation §4.3.1 says voluntary records rejected or accepted with admissible errors may need a
new corrected record unless a rectificativa/cancellation is required or a published exception
applies. Validation §4.3.2 and service description §10 instead require preserved records sent
under an AEAT requirement to remain uncorrected for business-rule errors. Those errors become
admissible, apart from NIF/`IDOtro` identity errors, which may reject a record. Service
description §10 also requires `FinRequerimiento: "S"` on the final batch. The library has no
knowledge of which batch is final and does not automate that flag or either correction policy;
callers must inspect the AEAT response and choose the appropriate workflow.

Sections 4.1–4.4 are accounted for end to end. `Correcto`, `ParcialmenteCorrecto`, and
`Incorrecto` represent complete acceptance, a mixture that includes a rejected or
accepted-with-errors line, and complete rejection. Per-record `Correcto`,
`AceptadoConErrores`, and `Incorrecto` remain separate evidence and must all be inspected. A
structural request or header syntax failure can instead arrive as a SOAP fault. The independently
published error-code list groups errors into whole-request rejection, record rejection (or
whole-request rejection when the error is in the header), and accepted-record errors. Its
downloaded 30 July 2026 bytes have SHA-256
`06519ceb23422bd6b0ad3bfb659e3007615050da4920781d12cff536481d5902` and are now part of the
weekly source watch.

The accepted-record category currently contains codes `2000`–`2009`. Section 4.3.1 names hash,
recipient census, total, first-record, missing IPSI-regime, and generation-clock cases; it exempts
the missing IPSI regime and future generation timestamp from correction. The separate list also
contains predecessor-hash codes `2002`/`2003` and same-as-current hash code `2008`, which the
section's prose does not enumerate. The parser therefore preserves the numeric code and
description rather than hard-coding a correction decision. The bilingual submission guides tell
callers to use the current published category and the response context. Whether a correction is
legally permissible instead of a rectificativa or cancellation remains a caller decision.

The current error list has the following complete category-level disposition. The counts describe
the watched 30 July 2026 source. They do not claim that the fake transport reproduces every code or
that local tests establish AEAT's live precedence between them.

| Official category                                               |    Current entries | Local behavior and evidence                                                                                                                                          | Deliberate limit                                                                                  |
| --------------------------------------------------------------- | -----------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Whole-request rejection                                         |                 44 | SOAP-fault and response handling keep the request outcome reportable                                                                                                 | Individual live meanings and precedence are not simulated                                         |
| Record rejection, or whole-request rejection for a header error |                193 | The response parser preserves integer codes and descriptions; representative fake-transport cases cover both record and header outcomes                              | The package does not hard-code a correction workflow for each code                                |
| Record accepted with errors                                     | 10 (`2000`–`2009`) | The parser preserves the status, code, and description; validation and fake tests exercise representative hash, total, census, first-record, regime, and clock cases | Codes `2002`, `2003`, and `2008` are absent from §4.3.1's prose, so correction remains contextual |

The serializer locally checks issuer and representative NIF form/control, both optional `S`/`N`
remittance flags, required reference content and its 18-XML-character maximum, and a real `FechaFinVeriFactu` in the current or
preceding Madrid calendar year. From 1 January 2027 the supplied date must also be `31-12-20XX`.
AEAT alone can establish that these identities and the reference are registered, and its system
clock is authoritative. The parser and serializer both enforce 1–1000 `RegistroFactura` wrappers
with exactly one alta or cancellation per wrapper; the parser also rejects a missing requirement
reference or invalid remittance flag rather than returning a misleading `Cabecera` value. TDD cases in `src/xml/serialize.test.ts` and
`src/xml/parse-request.test.ts` cover each boundary, XML order, round trips, untyped malformed
inputs, the year transition, and exact issue messages. The existing fake-AEAT identity tests retain
their two-taxpayer assertions with valid synthetic NIFs.

The `SuministroLR.xsd` inventory is complete for the unsigned request surface:

| Schema element or constraint                                                                 | Library behavior                                                                                                                                                                                                  | Evidence                                                                                                                        | Deliberate limit or stricter policy                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RegFactuSistemaFacturacion` root and namespace                                              | `serializeEnvio` emits the `sfLR` root inside a UTF-8 SOAP 1.1 body; `parseEnvio` selects that body                                                                                                               | Exact minimal/maximal XML tests, namespace tests, and offline schema validation                                                 | The request parser is a projection, not a general SOAP or XSD validator                                                                                                                                                                                                      |
| Sequence: one `Cabecera`, then 1–1000 `RegistroFactura` wrappers                             | The serializer always emits this order and rejects zero or 1,001 records; the parser applies the same occurrence bounds                                                                                           | Serializer/parser boundary tests and `xmllint` probes for 1,000, 1,001, and a header moved after a record                       | Incoming unknown, repeated, or reordered ordinary elements require validation against the pinned XSD; the projection does not preserve them                                                                                                                                  |
| `Cabecera.ObligadoEmision` and optional `Representante`                                      | Public types require Spanish identities; both XML boundaries enforce the 120-code-point name maximum and nine-code-point NIF shape                                                                                | RED/GREEN serializer/parser tests, 120/121-code-point XSD probes, and representative round trips                                | Serialization additionally checks the NIF control character. Parsing checks the XSD length only; AEAT registration remains external                                                                                                                                          |
| Optional `RemisionVoluntaria` then optional `RemisionRequerimiento`                          | The public union, serializer, and parser select at most one mode and preserve each block in schema order; absence of both remains the voluntary default                                                           | Both mode round trips, exact XML, full-schema fixtures for each mode, and a probe proving the schema itself accepts both blocks | Mutual exclusion is library policy, not an XSD choice. The library cannot infer the operating mode or final requirement batch                                                                                                                                                |
| `FechaFinVeriFactu`, `Incidencia`, `RefRequerimiento`, and `FinRequerimiento`                | Parsing enforces the XSD date shape, `S`/`N` enums, and 18-code-point reference maximum; both boundaries require nonblank reference content, while serialization also applies the published real-date/year window | Focused parser/serializer tests and exact 18/19-code-point schema probes                                                        | XML Schema accepts an empty `TextMax18Type`, so both boundaries are deliberately stricter there. Parsing accepts the schema's Unicode decimal digits while serialization applies its narrower business date policy. AEAT's clock and issued requirement remain authoritative |
| Each `RegistroFacturaType` choice references one `sf:RegistroAlta` or `sf:RegistroAnulacion` | Public `EnvioRegistro` is a union; both boundaries reject both/neither and retain caller order across mixed batches                                                                                               | Choice mutation tests in both request boundaries, namespace assertions, exact mixed XML, and negative XSD probes                | Record field coverage belongs to the completed `SuministroInformacion.xsd` inventory above                                                                                                                                                                                   |
| Optional record `ds:Signature` content imported by `SuministroInformacion.xsd`               | Generated requests are unsigned and pass the complete local request schema                                                                                                                                        | Minimal alta, cancellation, and both header-mode bodies pass `xmllint --nonet` through the pinned catalog                       | The library neither creates nor parses XML signatures; signed-message verification is outside its surface                                                                                                                                                                    |

The source watch on 26 September 2026 reported that every watched publication still matched its
pinned fingerprint. These offline checks establish schema conformance of generated unsigned bodies,
not endpoint selection, certificate authorization, requirement validity, or live AEAT acceptance.

### Per-record response operation — service description §6.4.4 and response XSD

`RespuestaSuministro.xsd` requires an `Operacion` block on every response line, with a nested
`TipoOperacion` (`Alta` or `Anulacion`) and optional correction indicators in the order defined by
`SuministroInformacion.xsd`. `parseRespuestaSuministro` now exposes that structured block instead
of typing it as a string. It preserves unfamiliar code values so one line cannot discard the
entire batch response. The fake AEAT emits the block for accepted, rejected, and duplicate records.
Parser and fake-AEAT tests cover both operation kinds, correction indicators, unfamiliar codes,
and wire element order. The parser continues to accept an omitted block so a malformed or future
line cannot hide the batch's one-time CSV; it is not a full XSD validator and cannot establish
that AEAT returned a schema-valid response. The fake's duplicate-detail block uses the XSD's
child-namespace qualification and order, with
a stable synthetic petition ID for the previously stored record. When a test deliberately hides
the duplicate state, the fake omits the optional block rather than emitting an empty block with
missing required children. `src/testing/fake-aeat.test.ts` checks the raw XML and both parsed
paths. A submitted cancellation replaces the stored record and its petition ID; the fake's
state-only `annul` hook keeps the original alta and petition ID. The fake now emits the published
response namespaces, echoes the submitted `Cabecera`, and places the wait, status, and lines in
schema order. Offline tests validate accepted, rejected, duplicate, voluntary, and
under-requirement fake responses against the pinned response XSD. That proves the tested fake XML,
not live AEAT behavior.

### Global submission status — service description §§3, 6.5.2

AEAT returns `Correcto` only when every response line is `Correcto`,
`ParcialmenteCorrecto` when at least one line is `AceptadoConErrores` or a batch mixes
accepted and rejected lines, and `Incorrecto` when every line is rejected. An all-rejected
response has no CSV; a partially correct response has one. The fake AEAT now follows these
batch-level rules. `src/testing/fake-aeat.test.ts` covers a wholly accepted batch, a
future-generation-time `AceptadoConErrores` line, a mixed batch, an all-rejected two-line batch,
and a duplicate-only retry, including CSV presence or absence. The duplicate test also
checks the raw XML omits `CSV` and that `resolveEstadoEfectivo` finds the previously
accepted record despite the rejected retry. The real response parser exposes AEAT's global,
per-line, and duplicate-detail status strings without assuming the response is schema-valid. It
preserves the CSV and recognized lines when a status is missing or unfamiliar, and trims
whitespace around all three status fields. `resolveEstadoEfectivo` returns `status_unknown` for a
missing or unfamiliar line status rather than falsely calling it rejected; focused tests cover those
boundaries and a mixed batch. An unfamiliar duplicate-detail status still resolves to
`duplicate_unknown`. The exported known-code types describe AEAT's XSD enums, while parsed
status properties are wider because malformed or future responses must not hide an
unretrievable CSV. `TiempoEsperaEnvio` now becomes `undefined` when absent or unusable, with the
parsed raw value in `TiempoEsperaEnvioRaw`, so callers can persist a one-time CSV and line states
before stopping their submission queue. The parser accepts one to four ASCII digits as a usable
wait, matching `sf:Tipo6Type`'s upper bound. It also tolerates surrounding whitespace while
preserving the literal for diagnosis. Although the XSD permits an empty value, an empty wait is
unusable for scheduling. Focused parser and client tests cover missing, empty, nonnumeric, signed,
fractional, overlong, repeated, and nested values without returning `NaN`. The parser
does not reconcile global and per-line values or validate the entire response XSD; the fake
remains a transport test double, not proof of a schema-valid AEAT response.

### Filing response fields — service description §6.4.4 and `RespuestaSuministro.xsd`

The response schema orders optional `CSV` and `DatosPresentacion` before required `Cabecera`,
`TiempoEsperaEnvio`, and `EstadoEnvio`, followed by zero to 1,000 response lines. A maximal fixture
containing every optional field passes offline validation against the pinned schema and imports.
Mutation probes independently reject missing or reordered required fields, a 1,001st line,
unfamiliar enum values, fractional integer codes, and every published text boundary. Separate
positive probes cover every value of `EstadoEnvio`, `EstadoRegistro`, `TipoOperacion`,
`Subsanacion`, `RechazoPrevio`, `SinRegistroPrevio`, and `EstadoRegistroDuplicado`.

| Published field             | Parser/fake behavior                                                                                                                                                                                     | Evidence and limit                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSV`                       | Returns the literal when present; the fake omits it only for a wholly rejected batch                                                                                                                     | Parser/fake tests and response-XSD fixture; the XSD gives this string no length bound, and consulta cannot recover it                                                                                     |
| `DatosPresentacion`         | Returns `NIFPresentador` and the literal `TimestampPresentacion`; rejects a repeated block, repeated/missing children, and an NIF whose length is not nine                                               | Parser and XSD tests; the parser requires a nonblank timestamp but leaves the full XML Schema `dateTime` lexical check to the XSD                                                                         |
| `Cabecera`                  | The fake echoes every submitted issuer, representative, voluntary, or requirement field in schema order; the parser deliberately does not expose the echo because the caller already supplied the header | Raw fake-response assertions and offline XSD validation; capture the raw response if the echo is needed for diagnostics                                                                                   |
| `TiempoEsperaEnvio`         | Returns a usable one-to-four-ASCII-digit value as seconds and preserves the raw parsed shape separately                                                                                                  | Parser tests cover usable and malformed shapes; the XSD itself permits an empty zero-to-four-digit string, which cannot schedule work                                                                     |
| `EstadoEnvio`               | Preserves a trimmed raw string or `undefined`; the fake emits the three published values according to its batch model                                                                                    | Parser/fake tests plus all-enum XSD probes; unfamiliar/missing values remain visible so they cannot hide a CSV                                                                                            |
| `RespuestaLinea` occurrence | Normalizes zero, one, or several lines to an array; the fake returns one line per submitted record                                                                                                       | Offline XSD probes accept 1,000 and reject 1,001; the parser does not discard an otherwise inspectable response solely because a server exceeded the schema maximum                                       |
| `IDFactura`                 | Returns all three identity fields and rejects an absent, repeated, incomplete, or XSD-invalid NIF length, invoice-number length, or date shape                                                           | Parser and XSD tests; calendar validity and NIF control remain separate, and one malformed identity aborts the parsed response                                                                            |
| `Operacion`                 | Returns the four operation fields, trimming their codes; the fake emits the block for every line in schema order                                                                                         | Parser/fake tests plus all-enum and order probes; the parser preserves unfamiliar values and tolerates an omitted block to retain other line results and the CSV                                          |
| `RefExterna`                | Returns the literal when present and the fake echoes it                                                                                                                                                  | XSD probes cover the 60-character maximum; the parser preserves overlong diagnostic input rather than discarding the response                                                                             |
| `EstadoRegistro`            | Preserves a trimmed raw string or `undefined`; `resolveEstadoEfectivo` recognizes the three published values                                                                                             | Parser/fake tests plus all-enum probes; an unfamiliar value resolves to `status_unknown`                                                                                                                  |
| line error detail           | Converts `CodigoErrorRegistro` only when its lexical form is an integer representable safely by JavaScript and preserves `DescripcionErrorRegistro`                                                      | Parser tests reject fractional, nonnumeric, and unsafe values; XSD probes cover integer syntax and the 1,500-character description maximum                                                                |
| `RegistroDuplicado`         | Returns petition ID, stored-record state, and optional nested error detail; `resolveEstadoEfectivo` handles all three stored states                                                                      | Parser/fake tests and XSD probes cover required order, the 20-character petition ID, integer code, and 500-character description; malformed/future status text remains diagnosable as `duplicate_unknown` |

This parser is a loss-aware projection, not a replacement for XSD validation. In particular, it
does not enforce XML element order, the response-line maximum, or diagnostic text maxima after
parsing, because rejecting those shapes would also hide valid line outcomes and an unrecoverable
CSV. It does enforce invoice identity, presentation identity, and numeric type promises before
returning them through the public TypeScript API. If a malformed identity or numeric code throws,
the high-level client cannot return the other fields; integrations that need forensic access must
retain the raw HTTP response at their transport boundary.

### SOAP faults and voluntary flow control — service description §§5.1, 6.4.4.1

`src/client.ts` identifies SOAP Faults even when HTTP succeeds and includes the fault code and
reason in the thrown error. It does not classify faults into a typed retry policy or retry on
behalf of callers. The English and Spanish submission guides now distinguish AEAT's instruction
to resend the same message after a `Server` fault, stalled transmission, or unusable XML from a
`Client` fault, which requires inspecting `faultstring` and correcting the message first. They
also state the voluntary flow-control condition exactly: after a response, the next batch may
go when its `TiempoEsperaEnvio` expires or the queue reaches the maximum 1,000 records, whichever
comes first. The example's full-interval scheduler remains a conservative choice. The library
exposes the response wait and batch maximum but does not own the caller's queue or retry timing.

### SOAP transport and authentication — service description §§4.1–4.3

AEAT requires UTF-8 XML in a SOAP 1.1 document/literal message over HTTPS, authenticated with
a qualified client certificate. Both request serializers emit a UTF-8 XML declaration and a
SOAP 1.1 `Envelope`/`Body`; the bundled WSDL declares document/literal binding and an empty
`soapAction` for its operations. `createClient` posts `text/xml; charset=utf-8` with the empty
`SOAPAction` header. Exact request XML in `src/xml/serialize.test.ts`, the transport assertions
in `src/client.test.ts`, and the bundled `schemas/*.wsdl` support those wire-format checks.

The library accepts an injected `fetch` and endpoint. It neither loads certificates nor enforces
HTTPS or proves that a certificate is qualified or authorized for the taxpayer; the calling
deployment must supply that transport. Both submission guides show a certificate-bearing HTTPS
configuration and direct you to check it against AEAT preproduction. AEAT validates NIFs against
its own register, which cannot be established by local syntax and control-digit checks.

### WSDL messages, bindings, and ports — service description §§6.6–8

The [published WSDL](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl)
imports the common `SuministroInformacion.xsd` plus four request/response XSDs. Its four message
parts name submission request and response roots from `SuministroLR.xsd` and
`RespuestaSuministro.xsd`, and consulta request and response roots from `ConsultaLR.xsd` and
`RespuestaConsultaLR.xsd`. The voluntary port type exposes submission and consulta; the
under-requirement port type exposes submission only. Both bindings use SOAP 1.1's HTTP transport
with document/literal bodies and empty `soapAction`; all eight service addresses are HTTPS.
The client sends the matching SOAP 1.1 body and `SOAPAction: ""`; `src/client.test.ts` checks the
wire headers and both methods, while `src/xsd-conformance.test.ts` checks four unsigned request
bodies against their imported XSDs.

Service-description annexes 7 and 8 publish those same six artifacts under separate
`prewww2.aeat.es` test and `www2.agenciatributaria.gob.es` production URL sets. All 12 links
resolved on 26 September 2026. Five of the six test/production pairs were byte-identical; the
production `SuministroLR.xsd` has one extra ASCII space after its `<choice>` start tag and is otherwise
identical to the test copy. Substituting that production copy into a disposable checkout left all
194 request-schema tests green, so tested validation behavior is unchanged; the byte difference
still proves the two URL sets can drift independently. The weekly source watch therefore
fingerprints every annex URL separately while continuing to watch the three namespace URLs used by
generated XML. Its focused test fails if either six-artifact annex set is omitted.

The WSDL assigns four ports to each binding: ordinary and sello-certificate addresses in both
production and preproduction. `SistemaVerifactu`, `SistemaVerifactuSello`,
`SistemaVerifactuPruebas`, and `SistemaVerifactuSelloPruebas` match `SOAP_ENDPOINTS` and
`SOAP_ENDPOINTS_SELLO`; the four corresponding `SistemaRequerimiento` ports match
`SOAP_ENDPOINTS_REQUERIMIENTO` and `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO`. `src/endpoints.test.ts`
pins all eight full URLs. `src/wsdl-conformance.test.ts` parses the pinned sources and checks every
namespace/import pair, global element, message part, port-type edge, binding operation, body style,
action, port binding, and address. This ties the WSDL to the exported endpoint constants instead of
leaving the relationship as a manual comparison.

The fake transport now emits consultation responses with the published response and common
namespaces, echoed `Cabecera` and `PeriodoImputacion`, and the exact response-XSD sequence. Empty and
populated issuer and recipient responses pass `RespuestaConsultaLR.xsd`, including a populated
external reference; filing fake responses continue to pass `RespuestaSuministro.xsd`. `createClient`
still accepts any caller-supplied endpoint and cannot prevent consulta being sent to a
requirement-only URL, so select the voluntary endpoint for consulta. These offline checks do not
prove certificate authorization or live service acceptance.

#### Global element coverage index

The WSDL can only dispatch global schema elements, so this index is the boundary between the five
schema inventories and the client transport. These six globals are exhaustive and asserted by
`src/wsdl-conformance.test.ts`. The five family inventories account for local named and anonymous
types and child fields under the filing-record, submission-envelope, consultation-request,
filing-response, and consultation-response roots.

| Audit item | Source family               | Inventory boundary                                                                                |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| E2         | `SuministroInformacion.xsd` | Alta and cancellation records, shared types, choices, lengths, numeric bounds, and XML order      |
| E3         | `SuministroLR.xsd`          | Submission and requirement headers, record wrappers, occurrence limits, and request order         |
| E4         | `ConsultaLR.xsd`            | Consultation identities, filters, choices, limits, and request order                              |
| E5         | `RespuestaSuministro.xsd`   | Filing response header, line identities, states, codes, duplicate details, occurrences, and order |
| E6         | `RespuestaConsultaLR.xsd`   | Returned records, presentation data, status, cursor, occurrences, lexical forms, and order        |
| E7         | `SistemaFacturacion.wsdl`   | Imports, messages, operation edges, bindings, ports, addresses, and links to all five XSDs        |

| Source                      | Global element                             | WSDL or library consumer                                                                                                        | Executable evidence                                                                             | External limit                                                                                                  |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `SuministroInformacion.xsd` | `RegistroAlta`                             | `SuministroLR.xsd` references it from each request record choice; `serializeEnvio` and `parseEnvio` produce and consume it      | Cross-schema import/global-element check plus generated alta request XSD tests                  | AEAT acceptance and optional XML signatures require the live service or an external signer                      |
| `SuministroInformacion.xsd` | `RegistroAnulacion`                        | `SuministroLR.xsd` references it from the other request record choice; `serializeEnvio` and `parseEnvio` produce and consume it | Cross-schema import/global-element check plus generated cancellation request XSD tests          | AEAT acceptance and optional XML signatures require the live service or an external signer                      |
| `SuministroLR.xsd`          | `RegFactuSistemaFacturacion`               | Submission input message; `createClient.submit` sends it and the fake transport dispatches it                                   | WSDL message/operation/binding tests, client wire test, and generated request XSD tests         | Certificate authorization and under-requirement references remain external                                      |
| `ConsultaLR.xsd`            | `ConsultaFactuSistemaFacturacion`          | Consultation input message; `createClient.consultar` sends it and the fake transport dispatches it                              | WSDL message/operation/binding tests, client wire test, and generated request XSD tests         | Consulta is absent from the under-requirement port type; live query authorization remains external              |
| `RespuestaSuministro.xsd`   | `RespuestaRegFactuSistemaFacturacion`      | Submission output message; `parseRespuestaSuministro` and the fake transport consume and produce it                             | WSDL output-link test plus accepted, rejected, and duplicate fake-response XSD tests            | The parser is a projection and does not replace whole-response validation for arbitrary live XML                |
| `RespuestaConsultaLR.xsd`   | `RespuestaConsultaFactuSistemaFacturacion` | Consultation output message; `parseRespuestaConsulta` and the fake transport consume and produce it                             | WSDL output-link test plus issuer, recipient, populated, field, order, and occurrence XSD tests | The parser deliberately omits echoed header/period fields and recursive validation of the stored-record subtree |

### Submitted invoice-number lengths — `sf:TextoIDFacturaType`

`SuministroInformacion.xsd` uses `TextoIDFacturaType` for an alta's `NumSerieFactura`, a
cancellation's `NumSerieFacturaAnulada`, and the invoice numbers in rectified or substituted
references. The type requires 1–60 Unicode code points. `serializeEnvio` now checks each of these
paths, with the batch and reference indexes in its error, before the client can post XML. Focused
tests reject empty or 61-character main numbers, reject overlong references in both lists, and
confirm that the client makes no network call after a length failure. Offline `xmllint` probes
accept a 60-code-point generated alta number and reject invalid alta, cancellation, and referenced
numbers against the bundled request XSD. This serializer boundary does not replace `validate`'s
separate character-set and fiscal checks or prove AEAT will accept a submitted record.
`parseEnvio` now reuses the same invoice-number guard, while full raw-XML ordering and
unknown-element validation still require the pinned XSD.

`Encadenamiento.RegistroAnterior.NumSerieFactura` instead uses `sf:TextMax60Type`: it allows an
empty value but no more than 60 Unicode code points. The serializer now enforces that upper bound
for both alta and cancellation records. Offline XSD probes confirm the 60-code-point, 61-character,
and empty boundaries. `validate` counts Unicode code points for main and referenced invoice-number
lengths too; its narrower character rule still rejects emoji in the main number.

### XML text and escaping — service description §§6.7, 6.9

Pages 46–47 of the watched version 1.0.3 PDF were extracted and rendered on 26 September 2026.
AEAT trims leading and trailing whitespace from XML text fields before storing and returning them.
`buildCadenaAlta` and `buildCadenaAnulacion` use `trimValue` on each hash-input value; the exact
U+0020 boundary, preserved interior space, and published alta example are tested in
`src/format.test.ts` and `src/huella.test.ts`. The serializer escapes `&` and `<` as §6.9 requires,
along with the other XML metacharacters. `src/xml/serialize.test.ts` pins the escaping order, and
`src/xml/parse-request.test.ts` checks that escaped text round-trips without silently trimming the
submitted literal. That parser represents what the caller sent, not AEAT's later stored value.

The fake AEAT does not emulate AEAT's text trimming. A focused submission probe stored
`RefExterna: "  ref & <1>  "` with its edge spaces intact. Use AEAT preproduction, not the fake, to
check behavior that depends on the agency's trimmed response or stored value. The exact Unicode
scope of AEAT's whitespace normalization remains unverified by a live response.

### Consultation list values — service description §6.5.1 and `SuministroInformacion.xsd`

`PeriodoImputacion.Periodo` permits only the zero-padded months `01`–`12`, and a consultation's
`IndicadorRepresentante` permits only `S` when `ObligadoEmision` is present. `serializeConsulta`
rejects an invalid month or representative flag before sending XML. `parseConsulta` applies the
same checks to a parsed request; the public header type now excludes `N`. Boundary, invalid-value,
and recipient-header cases are covered in `src/xml/serialize.test.ts` and
`src/xml/parse-request.test.ts`. `ConsultaFiltro.Periodo` remains a `string` so callers can supply a
dynamically formatted month; the runtime boundary enforces the published list.
`parseConsulta` checks the literal XML leaf without trimming it, so spaces inside either code-list
element also fail locally. This keeps the parser's lossless-text policy; a hand-written fixture
should indent between elements, not inside `Periodo` or `IndicadorRepresentante`.
Service description §6.4.1 and the `ConsultaLR.xsd` annotation require a recipient consulta to
omit `MostrarSistemaInformatico` or set it to `N`. The serializer and request parser reject `S`
for that header before the fake or a real transport receives the request; issuer queries may use
`S`. `src/xml/serialize.test.ts` and `src/xml/parse-request.test.ts` cover the rejected and
allowed forms. The two response options are both `S`/`N` enumerations in
`SuministroInformacion.xsd`; the shared serializer/parser guard now rejects other runtime values
for issuer and recipient queries, preserving the stricter recipient rule. Focused serializer,
raw-request, and client tests cover rejected values before network transport. This closes every
consultation request enum in the two schemas. The raw request parser also rejects
duplicate `DatosAdicionalesRespuesta` blocks, which otherwise become an array and silently drop
both option values before the shared guard runs.
An `xmllint --xpath` extraction of the bundled XSD confirmed exactly `01`–`12` and `S`.
`src/xsd-conformance.test.ts` now checks generated unsigned message bodies against the bundled
AEAT request schemas. `test/xsd/catalog.xml` resolves the external XML-signature import to a
local placeholder for its optional `Signature` element; the test refuses signed messages because
that placeholder does not validate signatures. Passing request shapes include a minimal issuer
consulta, a recipient consulta with every filter and software-field family, an alta, and a cancellation. A
deliberately invalid consultation year and out-of-bounds filter lengths are rejected by the schema,
confirming that a failed import cannot produce a false green result. These are fixture-level XSD
checks, not proof that every public input combination or SOAP envelope is schema-valid or accepted
by AEAT.

### Consultation request period — service description §6.4.1 and `sf:YearType`

You must supply `PeriodoImputacion` even when querying one invoice. Its `Ejercicio` is a four-digit
year in the service table and `SuministroInformacion.xsd`; its `Periodo` is one of `01`–`12`.
`serializeConsulta` and `parseConsulta` now reject missing, short, padded, or non-digit years as
well as invalid months. They keep the year as a string so the exact four digits survive a
serialize/parse round trip. `src/xml/serialize.test.ts` and `src/xml/parse-request.test.ts` cover
valid bounds and invalid literals, including a whitespace-padded XML leaf. The client uses this
serializer, so invalid values fail before transport. The guard checks the year’s lexical shape,
not whether a calendar period is plausible for a particular taxpayer or date. XML Schema's `\d`
also allows Unicode decimal digits in the year; the guards accept these but do not normalize them.

The complete §6.4.1 filter table is covered by the request-schema inventory below. Consultation
header NIF control remains a separate business-level question: the XSD fixes its length at nine
characters, while only AEAT can establish registration and authorization.

`ConsultaLR.xsd` gives the top-level `NumSerieFactura` filter and the pagination key's
`NumSerieFactura` the shared `TextoIDFacturaType` limit of 1–60 Unicode code points. Its
`RefExterna` uses `TextMax60Type`, which permits an empty value but no more than 60 code points.
Both `serializeConsulta` and `parseConsulta` reject values outside these bounds. Focused
serializer/parser tests cover missing-length and overlong cases, and offline XSD probes confirm
the 60-code-point boundary and rejection of the invalid values. The pagination key's
`IDEmisorFactura` also has the `NIFType` length of exactly nine Unicode code points; both request
boundaries enforce it, with an offline XSD rejection probe. Other nested identity/text fields have
targeted checks below, not full request-XSD validation. The response parser now applies the same
invoice-number and date-shape bounds to a continuing cursor before returning it. Both request and
response XSDs declare that cursor with `IDFacturaExpedidaBCType`; actual AEAT responses still need
preproduction observation.

The service description §6.4.1 and `sf:fecha` require `DD-MM-YYYY` text for an exact issue-date
filter, each supplied range endpoint, and the pagination key's required date. `serializeConsulta`
and `parseConsulta` reject malformed values at those paths; the client therefore sends no request
with a malformed date. Offline request-XSD probes reject slash-formatted dates in all four places
and accept a `31-02-2026` literal, which demonstrates that the XSD tests text shape rather than
calendar reality. The XSD's `\d` also accepts Unicode decimal digits; an offline Arabic-digit
probe and serializer/parser tests keep that valid path open. The library leaves real-date and range-order policy to the caller. Empty range
endpoints remain optional under `RangoFechaExpedicionType`; the pagination date is required.
The bundled fake AEAT compares stored and queried date strings, and its range comparison assumes
ASCII digits. Use ASCII digits for fake-AEAT filtering until its Unicode semantics are addressed;
the actual AEAT service's handling of Unicode-equivalent dates has not been verified live.

`sf:FechaExpedicionConsultaType` lets a consultation date wrapper contain an exact date or a
range, but not both. `parseConsulta` now rejects both alternatives together, repeated wrappers,
repeated alternatives, and non-XML-whitespace text beside or in place of a child element. It still
accepts an empty wrapper, including one containing only XML whitespace, which the XSD permits.
Parser tests and offline XSD probes cover these boundaries.
This targeted check does not turn the raw parser into a complete XSD validator; other unexpected
children and XML ordering remain separate audit surfaces.

### Consultation identities and software filter — service description §6.4.1 and `SuministroInformacion.xsd`

The consultation header accepts an issuer or recipient, not both; the runtime also rejects neither
with a deliberate error. Although the XSD's choice permits neither, the raw parser already rejected
that header and the public TypeScript type requires one identity. The counterpart and software
filters each require `NombreRazon` and exactly one of `NIF` or `IDOtro`. The serializer and raw
request parser now reject missing or double identity branches, malformed nine-character NIF
lengths, overlong names, invalid `IDOtro` types and IDs, and country codes outside AEAT's
`CountryType2` list. The software filter also checks its required ID and installation fields,
optional text limits, and `S`/`N` usage flags. These checks run before an untyped request can
produce malformed XML or a parsed request can silently lose an identity branch. They count
Unicode code points for XSD length limits and retain XSD-valid empty values in required
max-length text fields. Serializer, raw-parser, and offline XSD tests cover those boundaries; the
country-code parity test compares the entire local code list with the pinned AEAT schema.
These are XSD-shape checks, not AEAT identity-registration checks. In particular, a header NIF
with nine characters is not necessarily a valid Spanish tax number; live AEAT authorization and
NIF control remain separate.

The `ConsultaLR.xsd` inventory is complete for the unsigned request surface:

| Schema element or constraint                                | Library behavior                                                                                                                                                                                  | Evidence                                                                                                                                    | Deliberate limit or stricter policy                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConsultaFactuSistemaFacturacion` root sequence             | `serializeConsulta` emits one `Cabecera`, one `FiltroConsulta`, then at most one `DatosAdicionalesRespuesta`; `parseConsulta` requires the first two and rejects repeated response-options blocks | Exact XML and round-trip tests; controlled offline mutations reject repeated or reordered top-level blocks and an out-of-order filter field | The parser projects known fields and does not validate namespaces, unexpected children, or general XML order; whole-request runtime XSD validation remains an open consumer-need question rather than part of this closure |
| `Cabecera.IDVersion`                                        | The serializer always emits `1.0`; the parser rejects a missing, repeated, or unfamiliar value before returning the header                                                                        | RED/GREEN parser regression and independent offline XSD mutations                                                                           | The public header type omits this constant because callers cannot choose it                                                                                                                                                |
| Header issuer/recipient choice and `IndicadorRepresentante` | Public types select one identity; both boundaries require one and reject both, and permit the representative flag only as `S` beside an issuer                                                    | Header round trips, untyped-input regressions, duplicate-element tests, and full-schema probes                                              | The XSD choice permits neither identity because both branches have `minOccurs=0`; the library is deliberately stricter. NIF registration and certificate authority remain external                                         |
| Required `PeriodoImputacion`                                | Both boundaries require a four-decimal-digit `Ejercicio` and one month from `01` to `12`                                                                                                          | Boundary, Unicode-digit, whitespace, and offline XSD tests                                                                                  | Calendar and taxpayer-period policy remain caller and AEAT responsibilities                                                                                                                                                |
| Optional invoice number and counterpart filters             | Both boundaries enforce invoice-number length, counterpart text and identity choice, country and ID-type enums, and imported text limits                                                          | Serializer/parser regressions plus Unicode boundaries, complete country-list parity, and negative XSD probes                                | The annotation's `Obligado` and `Destinatario` name which party belongs in the block; the element remains optional. Offline schema validity does not prove AEAT authorizes every broad query                               |
| Optional exact/range issue-date filter                      | Both boundaries preserve the wrapper choice, date text shapes, optional range endpoints, and single occurrences                                                                                   | Exact/range round trips, mixed-text and occurrence regressions, and positive/negative XSD probes                                            | The XSD accepts an empty wrapper and impossible calendar dates; the library follows those lexical rules and does not order the range                                                                                       |
| Optional software-system filter                             | Both boundaries enforce its identity choice, required system/installation IDs, optional text limits, and three `S`/`N` flags in schema order                                                      | Maximal generated request, field-boundary regressions, identity choice tests, and XSD mutations                                             | These checks establish XML shape, not that AEAT recognizes the installation                                                                                                                                                |
| Optional external reference and pagination key              | Both boundaries enforce the 60-code-point reference and invoice-number limits, nine-code-point issuer NIF, required cursor children, and date shape                                               | Empty, exact, overlong, and Unicode boundary tests plus offline XSD probes                                                                  | NIF control, calendar validity, and whether a cursor belongs to the queried result set remain external                                                                                                                     |
| Optional response-detail flags                              | Both boundaries accept only `S`/`N`, enforce the recipient restriction on software details, and preserve schema order                                                                             | Issuer/recipient regressions, duplicate-block tests, maximal request validation, and exact XML                                              | The performance effect described by AEAT and returned live fields are not established by offline request validation                                                                                                        |

The source-watch attempt on 25 September 2026 could not resolve the AEAT or GitHub hosts, so it
does not establish that the live publications were unchanged for this inventory. The bundled
`ConsultaLR.xsd` still matches the recorded SHA-256
`bf2cdb8fc4b95b291757a72b76d8fffca06a6d30d9329122ca2fd6b2d5f8f1b1`. The audit therefore
closes the pinned offline schema only; publication freshness remains unverified until the watch
can reach AEAT again.

### Filing `IDOtro` shape — `SuministroInformacion.xsd`

The filing `IDOtro.CodigoPais` element uses the same `CountryType2` enumeration as consultation.
`validate` now reports `IDOTRO_COUNTRY_CODE` for a supplied value outside that list on the software
producer, third party, recipient, or cancellation generator. It also checks the `02`–`07` ID-type
enumeration and the required `ID` element's 20-character maximum (`IDOTRO_IDTYPE` and
`IDOTRO_ID_SHAPE`). `serializeEnvio` checks the same shape before building XML, including when
called directly without `assertValid`. The shared country-code list is compared with every value
in the pinned AEAT XSD. Four-role validation and serializer regressions, a separate cancellation
software-producer regression, a schema-valid special `QU` filing, schema-rejected
`ZZ`/`01`/overlong-ID mutations, and valid empty/20-code-point ID
boundaries verify the rules. An empty `ID` is XSD-valid; these shape checks do not determine
whether a foreign identity is registered with AEAT or accepted under other business rules.

### Consultation response flags and cursor — service description §§6.4.2–6.4.3

`RespuestaConsultaLR.xsd` restricts `ResultadoConsulta` to `ConDatos`/`SinDatos` and
`IndicadorPaginacion` to `S`/`N`. Service description §6.4.3 says AEAT fills
`ClavePaginacion` for a continuing `S` page, so callers can echo that last-record identity in
the next query. `parseRespuestaConsulta` checks the literal enum values, rejects absent or
duplicated flag elements, and requires a single cursor with three present, XSD-shaped identity
fields for `S`. The XSD makes the cursor block optional without a conditional constraint; an unexpected
cursor on a final `N` page is ignored rather than discarding the page's records. The parser also
rejects incomplete invoice identities inside returned records and pages above the 10,000-record
schema maximum. Focused tests cover valid empty/final and continuing pages, malformed flags,
missing or repeated elements, record/cursor order, the page-size boundary, and blank identity fields.
This is a response-boundary check, not whole-response XSD validation; AEAT preproduction remains
the source of actual responses.

### Consultation response fields — service description §6.4.2 and `RespuestaConsultaLR.xsd`

The response schema requires `Cabecera`, `PeriodoImputacion`, `IndicadorPaginacion`, and
`ResultadoConsulta` in that order. It allows up to 10,000 records followed by an optional
`ClavePaginacion`. `parseRespuestaConsulta` is a projection of this response, not a complete
schema validator: it exposes the two flags, a continuation cursor when the flag is `S`, and the
record list, but it does not expose or validate the echoed header and period. Offline probes cover
the four required blocks, their order, both flag values, empty/final and continuing shapes, cursor
position/cardinality, and the exact record maximum. A maximal fixture containing every direct
returned-record field passes the pinned response XSD and its imports. Three separately declared
1,000-entry lists are checked at 1,000 and 1,001; all response-specific enum values are exercised.
Fields whose types come from `SuministroInformacion.xsd` reuse the completed filing-field inventory,
while the response-specific optionality and order are checked here. This remains offline structural
evidence; it does not prove which optional fields AEAT returns for a particular live query.

| Published record field                                    | Parser behavior                                                                                                                                                      | Evidence and limit                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IDFactura`                                               | Returns its three identity fields and rejects an absent, repeated, incomplete, or XSD-invalid NIF length, invoice-number length, or date shape                       | Parser tests and offline response-XSD probes; one invalid record aborts the entire parsed page, while calendar validity and NIF control remain separate                        |
| `DatosRegistroFacturacion`                                | Retains the stored subtree and literal string values; a present empty block becomes `{}` and an absent/repeated block is rejected                                    | A maximal XSD fixture covers every direct field, sequence, all direct enums and three 1,000-entry lists. The parser deliberately does not recursively validate this projection |
| `DatosPresentacion`                                       | Returns its three fields when present; rejects repeated/missing fields, invalid NIF length, overlong petition ID, and an invalid positive-year XML Schema `dateTime` | Parser tests and response-XSD controls; the empty petition ID permitted by `TextMax20Type` remains preserved                                                                   |
| `EstadoRegistro.TimestampUltimaModificacion`              | Returns the required timestamp literal; rejects absent, repeated, blank, or invalid positive-year XML Schema `dateTime` values                                       | Parser boundary tests plus valid/invalid XSD timestamp controls                                                                                                                |
| `EstadoRegistro.EstadoRegistro` and optional error detail | Checks all three states; rejects repeated fields, non-integer/unsafe-number codes, and descriptions above 500 Unicode code points                                    | Parser and XSD tests. XML Schema permits arbitrary-size integers, but the public `number` API deliberately refuses values JavaScript cannot represent exactly                  |

The required-block and occurrence checks prevent malformed XML from returning `undefined` or an
array where the public `RegistroConsultado` type promises one object, timestamp, state, code, or
description. They do not establish that an actual AEAT response contains every optional field;
that still needs a preproduction observation.
For a continuing page, `ClavePaginacion` receives the same NIF-length, invoice-number, and date
shape checks as `IDFactura`, so a malformed cursor fails at the response boundary instead of
being returned for a later request that would reject it. The parser still ignores an unexpected
cursor on a final page, preserving its records. The optional `DatosPresentacion` block now requires
all three XSD fields when present and retains the checked timestamp literal. The shared timestamp
guard covers the positive-year XML Schema forms AEAT publishes, including fractions, `Z`, numeric
offsets through ±14:00, and no timezone; negative years remain outside the operational API.
Unlike an ignored final-page cursor, a malformed record identity causes parsing to fail for the
whole response. The API does not return that page's other records or cursor in this case; callers
who need to diagnose non-conforming AEAT XML must capture the raw response at their transport
boundary.

### Hash generation and validation — hash specification §§1–7 (E13)

The watched 13-page PDF remains version 0.1.2 dated 27 August 2024, with SHA-256
`f4334c254bb875b417247b54315199f89d75a8c4814dfd1e86efec562653d7de`. Every page was extracted
and rendered on 26 September 2026, and the live source watch matched its pinned fingerprint.
Section 1 supplies the legal and implementation context without adding a separate data rule.

Hash specification §2 allows SHA-256, represented by `TipoHuella: "01"` in both builders. Section
3 lists eight ordered alta fields and five ordered cancellation fields; `buildCadenaAlta` and
`buildCadenaAnulacion` include the preceding record's hash, or an empty `Huella=` for the first
record, and trim the ends of each input value before joining `name=value` pairs with `&`. Section
3 requires UTF-8 bytes. Section 5 requires a 64-character uppercase hexadecimal output, including
for the first record. `src/huella.test.ts`, `src/format.test.ts`, and `src/records.test.ts` cover
these rules, while `src/conformance.test.ts` pins all three worked examples in §6. The Java
snippet in §4 illustrates the same input construction; it adds no separate wire format.

Validation §3.1.3.23 and §3.1.4.7 require the submitted alta or cancellation hash to match
[AEAT's hash specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf).
The builders hash the serialized field literals in the published order, and `verifyHuella` checks
an existing record. `validate` now reports a non-blocking `HUELLA_MISMATCH` for a well-formed but
incorrect hash, and `HUELLA_FORMAT` for a value that is not 64 uppercase hexadecimal characters.
Missing values, values exceeding the XSD's 64-character maximum, and XML control characters remain
locally blocking. Both record types, the advisory severity, non-throwing `assertValid`, and those
XML boundaries are covered in `src/validate.test.ts`. The three AEAT examples are checked directly,
without changing their published input strings or expected hashes, in `src/conformance.test.ts`
and through third-party fixtures in `src/upstream-conformance.test.ts`. They cover a first alta,
a chained alta, and a chained cancellation: every supported record shape in §6.
Hash specification §7 says AEAT marks a submitted record `Aceptado con errores` when its hash does
not match AEAT's calculation; the local mismatch issue is therefore advisory, not a substitute
for the returned status. Section 3 allows numeric values with one or two decimal places and
trailing zeroes. The builders always emit two decimals and hash that exact text. A direct record
with `123.1` instead of `123.10` gets a different _local_ hash, as `src/huella.test.ts` proves;
the published vectors do not show how AEAT compares the two forms. A controlled preproduction
submission and read-only consultation remain necessary before claiming they yield distinct AEAT
hashes or changing local canonicalization. The third-party fixture's prose makes the stronger
claim but is not an official source; only its three AEAT-derived vectors are used as evidence.
The specification also defines event-record inputs and `HuellaEvento`. This library does not
build or submit event records, so those fields, their repeated `NIF` key and their predecessor
chain remain explicitly outside its supported surface. No hash literal, record serializer or
golden fixture changed during this closure.

### Numeric XML values — service description §6.8

AEAT forbids leading zeroes in numeric XML values but permits trailing zeroes in decimals to
express precision. The record builders emit amounts with exactly two decimal places and no leading
zeroes. For records constructed or edited directly, `validate` now applies the same leading-zero
rule to totals, detail amounts, rectification amounts, and tax rates. `src/validate.test.ts` covers
each field, the negative-sign case, valid zero, and suppression of dependent total-mismatch checks
after a malformed amount. The library's two-decimal policy is stricter than the schema's accepted
decimal shapes. Date components are zero-padded, as §6.8 explicitly requires; text-valued codes
and identifiers such as `ClaveRegimen: "01"` and `NumeroInstalacion: "001"` are not numeric XML fields.
The local check does not replace AEAT's schema or service validation.
Checks that need a parsed amount, including the large-invoice `Macrodato` check, defer until the
amount's syntax is corrected; callers should validate again after fixing an `AMOUNT_FORMAT` issue.

### Worked operating flows — service description §§9–11 (E12)

The watched 101-page version 1.0.3 PDF still has SHA-256
`b3570f6a308ce98a5f52001a0dc427310ad6cf7bccd60a9ee98720a59e553c02`. Pages 52–101 were extracted
and rendered on 26 September 2026, and the live source watch matched every pinned fingerprint.
The examples use placeholders such as `AAAA` and `Huella`, so they are not valid NIF or hash test
vectors. This inventory checks their operation, element choice, order and flow without presenting
the placeholder values as accepted AEAT data.

| Published example or flow                             | Library behavior and executable evidence                                                                                                                                                                                                                                                                                              | Limit or disposition                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §9.1.1 ordinary alta                                  | `buildAltaRecord` omits `Subsanacion` and `RechazoPrevio` unless supplied; `serializeEnvio`, `parseEnvio`, the request XSD suite and the fake's clean-alta test cover the published alta shape and accepted response                                                                                                                  | The example's illustrative NIFs and hashes are not conformance vectors                                                                                                                                                                                                                                              |
| §9.1.2 subsanación of an existing record              | The builder preserves `Subsanacion: "S"`; validation and both XML boundaries preserve the flag; the fake replaces an existing record and keeps the original attempt immutable                                                                                                                                                         | Whether a correction is legally appropriate remains the caller's decision                                                                                                                                                                                                                                           |
| §9.1.3 alta after a rejected initial alta             | `Subsanacion: "S"` plus `RechazoPrevio: "X"` is supported and tested as the no-prior-record path; the fake refuses it when the identity already exists                                                                                                                                                                                | Exact live error precedence and rejection-history retention remain external checks                                                                                                                                                                                                                                  |
| §9.2.1 ordinary cancellation                          | `buildAnulacionRecord`, both XML boundaries and the fake cover cancellation of a stored alta, including chaining and the cancellation's own hash                                                                                                                                                                                      | The library does not decide whether cancellation rather than a rectificativa is legally required                                                                                                                                                                                                                    |
| §9.2.2 cancellation after a rejected cancellation     | `RechazoPrevio: "S"` is preserved and the fake accepts it only after a rejected cancellation for the same identity; focused controls prove that an accepted retry consumes that history                                                                                                                                               | The fake uses a one-operation history marker, not AEAT's unpublished retention model                                                                                                                                                                                                                                |
| §9.2.3 cancellation without a stored alta             | `SinRegistroPrevio: "S"` is preserved and tested as the special no-prior path; the fake rejects the ordinary path without a stored record and rejects the special path when one exists                                                                                                                                                | The annex does not assign an exact response code to every state; the fake's codes remain representative                                                                                                                                                                                                             |
| §9.3.1 two altas plus one cancellation in one request | `EnvioRegistro[]` preserves caller order and accepts mixed wrappers; serializer/parser tests cover the one-to-1,000 batch boundary and the fake proves that an earlier line's stored state affects later lines in the same batch                                                                                                      | The library does not reorder records or verify that their hashes form one chronological chain                                                                                                                                                                                                                       |
| §10 preamble and §§10.1–10.2 requirement examples     | `Cabecera.RemisionRequerimiento` requires `RefRequerimiento`, preserves optional `FinRequerimiento`, and serializes before the same alta/cancellation record shapes. The guides require `FinRequerimiento: "S"` on the final batch and tell callers to send preserved records without changing business data to satisfy `assertValid` | The fake has one shared store and voluntary rejection policy. A direct requirement-header probe still rejected a future invoice with `1112`; use it for XML and parser tests, not as proof that the separate requirement service admits every non-identity business error. The library cannot infer the final batch |
| §11.1.1.1 issuer period query and response            | `serializeConsulta` requires the imputation period; the fake filters by operation date with issue-date fallback; `parseRespuestaConsulta` covers the returned identity, stored data, presentation data, state, final-page flag and no-CSV result                                                                                      | The worked response spells the state `Correcta`, but the current watched `RespuestaConsultaLR.xsd` permits `Correcto`, `AceptadoConErrores`, or `Anulado`. The parser follows the current XSD and rejects the obsolete feminine literal. Echoed header and period remain outside its deliberate projection          |
| §11.1.1.2 counterparty filter                         | Issuer-side `Contraparte` serialization, parsing and fake filtering cover the published NIF branch; the completed request-XSD inventory also covers `IDOtro`                                                                                                                                                                          | Certificate authorization and the breadth of permitted queries need preproduction evidence                                                                                                                                                                                                                          |
| §11.1.1.3 issue-date range                            | The request type and both XML boundaries enforce the exact-date/range choice; the fake applies inclusive `Desde` and `Hasta` bounds                                                                                                                                                                                                   | The XSD permits an empty range and checks lexical shape rather than calendar reality                                                                                                                                                                                                                                |
| §11.1.2.1 recipient pagination                        | The recipient header, optional issuer counterparty, response cursor and next-request `ClavePaginacion` are covered end to end. The parser rejects more than 10,000 returned records; the fake uses a configurable small page size and insertion order as a presentation-time stand-in                                                 | Only AEAT can establish recipient authorization, exact presentation ordering, stale-cursor behavior and concurrent-page semantics                                                                                                                                                                                   |

No fiscal serializer, hash value or golden fixture changed in this audit. The current XSD/WSDL graph
remains the authority where an older worked example conflicts with it.

### QR URL, lookup, and printed presentation — QR specification §§1–12 (E13)

The watched 35-page PDF remains version 0.5.0 dated 10 December 2025, with SHA-256
`f86b3c260d8a4963dbc18c5007732b53199156c5d1db63242e68db71501b49eb`. Every applicable page,
including all response screenshots and all twelve annex layouts, was extracted and rendered on
26 September 2026. The live source watch matched the pinned fingerprint.

The public `buildQrPayload` returns a URL, not a QR image. For a verifiable invoice, it selects the
published preproduction or production `/ValidarQR` endpoint (§5.1), percent-encodes the record's
NIF, serial, date, and amount (§4), and includes exactly those four mandatory parameters in the
published order (§6). It passes the record's text through unchanged: AEAT's §8 examples use a
one-decimal amount, while the builders emit two decimals. `src/qr.test.ts`, `src/endpoints.test.ts`,
and `src/upstream-conformance.test.ts` cover the supported URLs and examples. The local
QR-safe serial alphabet is deliberately narrower than the printable ASCII accepted in §4/§6.
Callers should use a built and validated record; `buildQrPayload` itself does not validate one.

Section 7 allows optional `idioma` and `formato=json` on separate service requests, but §6
restricts the URL _inside the printed QR_ to four parameters and §7 expressly excludes `formato`
from it. The helper therefore adds neither option. The two verifiable §8 URLs and the §4
ampersand-encoding example are reproduced byte for byte by `src/upstream-conformance.test.ts`;
the two `/ValidarQRNoVerifactu` examples are deliberately excluded because this library builds
Veri*Factu records only. Section 1 states the publication's scope, and §11 cites its legal basis;
neither adds a separate URL-format rule.

Sections 9–10 publish HTML and JSON examples for found (`00`), not found or cancelled (`01`),
non-verifiable (`02`), missing-parameter and malformed-value outcomes, plus error codes
`1001`–`1004`, `2001`–`2006`, `3001`, and `3002`. The public package returns the lookup URL but
does not fetch, parse, localize, or classify those responses. The credentialed preproduction
harness adds `formato=json` outside the printed payload and checks only a successful `00` response
against the submitted invoice's four values. Its unit test covers that contract and a `01`
rejection. Cancelled-invoice lookup, `02`, chained errors, localized text, rate limiting, and the
remaining error codes require a consumer-owned lookup client or authorised live evidence.

The image requirements in §§2–3 and the twelve printed examples in §12 belong to the invoice renderer:
ISO/IEC 18004:2015, 30–40 mm square, error-correction level M, at least 2 mm clear space on each side (6 mm
recommended), prominent placement before content on the first page, `QR tributario:` above, and
the prescribed verifiable-invoice wording below. The English and Spanish QR guides now state
these requirements and the portrait/landscape placement preference. Annex examples `a`–`e` cover
verifiable narrow portrait and landscape invoices, `f`–`g` cover non-verifiable layouts without
the lower legend, and `h`–`l` cover A4 placement with permitted invoice content beside the QR.
The guides' render/decode example proves payload round-tripping and error-correction level only.
It does not prove physical dimensions, millimetre clear space, printed contrast, font size,
first-page placement, or compatibility with neighboring invoice content; each consuming invoice
renderer needs a physical render-and-scan check.

### Correction-state matrix — validation annex §6.1

AEAT's alta matrix distinguishes an initial registration from a `Subsanacion: "S"`
replacement. With `RechazoPrevio` omitted or `N`, a subsanación requires an existing record;
`RechazoPrevio: "X"` is the no-prior-record path. The fake AEAT now accepts the normal
replacement, including reactivating an annulled invoice, and replaces its stored hash,
reference, and consulta metadata. This includes reactivating a stored cancellation created without
a prior alta. It rejects a replacement with no prior record when `RechazoPrevio` is omitted,
`N`, or `S`, using
the [published `3002` missing-record code](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties).
`src/testing/fake-aeat.test.ts` covers these states,
the no-prior `X` path, and refusal to overwrite an existing record with that path.

`RechazoPrevio: "S"` is distinct from both ordinary subsanación and the no-prior `X` path: the
fake accepts it only after it has rejected an earlier subsanación for the same invoice identity.
Any accepted subsanación for that identity consumes the operation history. Focused controls show
that merely setting `S` cannot replace a stored alta, while an `X` attempt rejected against an
existing record establishes the history needed for a subsequent `S` retry. An alta that sets `S`
without `Subsanacion: "S"` gets published code `1161`; for a shaped retry without matching history,
the fake uses the published generic invalid-value code `1275`. This models the annex's transition,
not AEAT's unpublished retention period.

### Cancellation without a prior record — validation annex §6.2

AEAT's cancellation matrix requires an existing invoice record for an ordinary anulación
(`SinRegistroPrevio` omitted or `N`). `SinRegistroPrevio: "S"` is the special path when no
record exists at AEAT, and must not be used when one already exists. The fake now rejects an
ordinary cancellation with no prior record using `3002`, accepts the special no-prior path,
and refuses that path against an existing alta. Focused fake-AEAT tests cover each state and
preserve the stored record on rejection. Existing standalone-cancellation fixtures now carry
the published `S` indicator rather than relying on an invalid ordinary cancellation.
The fake also refuses that path against an existing cancellation, returning `3000` without
duplicate details in either existing-record case so `resolveEstadoEfectivo` cannot mistake the
refused operation for an accepted one. Out-of-domain `SinRegistroPrevio` values return the
[published `1276` invalid-field code](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties)
instead of being treated as `N`. Submission order matters: an ordinary cancellation placed
before its matching alta in one batch is rejected before that alta is stored.

Annex §6.2 names the allowed and forbidden states but not their numeric error codes. The fake
uses the published general `3000`/`3002` code meanings for these cases; the exact AEAT response
code and duplicate-detail shape for each state remain a preproduction check.

For a normal cancellation of an existing cancellation, annex §6.2 marks replacement with new
data as admissible (OK 8). The fake now replaces the stored hash, external reference, petition
ID, and consultation software-system metadata when the submitted hash or explicit reference
differs; the original invoice's issuer name and recipients remain available to consulta. The
first accepted cancellation and its replacement each report their own software system. An
unchanged hash with the same or an omitted reference keeps the fake's duplicate behavior and
the stored reference. Tests cover a stored
alta followed by two cancellations, a no-prior cancellation followed by a normal one, a
reference-only change, buyer-side and issuer-side consulta of the new snapshot, both software
systems, and the exact retry's petition ID. The
hash/reference comparison is the fake's limited way to detect new data: it does not compare
every non-hashed field or establish AEAT's retry behavior for an identical cancellation.

Both cancellation retry rows are now covered. `RechazoPrevio: "S"` requires a previously rejected
cancellation for the same identity; the ordinary retry still requires an existing AEAT record,
while the `SinRegistroPrevio: "S"` retry still requires that no record exists. Controls prove the
same flags are refused with `1275` without matching rejection history and that any accepted
cancellation consumes it. The fake's `forget()` control also clears that history with the stored
invoice trace.
The fake also distinguishes the error tables' date cases: a future invoice date rejects with
`1112`, while a future `FechaHoraHusoGenRegistro` is stored as `AceptadoConErrores` with `2004`.
Only AEAT's clock and unpublished tolerance can decide the live boundary.

The offline §6 matrix is complete for the fake's one-record-per-invoice model. It records only
whether the matching operation kind was rejected, not AEAT's complete attempt history, and its
`3000`/`3002` choices for other matrix errors remain representative because the annex does not
assign codes to every cell. The library does not select a correction operation for callers; check
legal eligibility, live error precedence, clock tolerance, and long-lived history against AEAT
rather than treating the fake as an authority.

## Audit state after the official-document closure

### Completed offline audit

The dated source table, validation ledger, error-category disposition, service-description map,
hash and QR inventories, and five-XSD/WSDL graph are closed for the supported package surface. The
source watch can reopen only an affected row when AEAT changes a publication. The remaining limits
in those rows are explicit external checks, not missing source sections.

### Pending FAQ work

Developer FAQ v1.3 entries 1–15 are reviewed in the coverage map above. Entries 16–27 and 29
(including the version-history explanation for removed entry 28) remain for E16. The 18 pages
currently linked by the public FAQ index remain for E17–E18. Each pending entry must point to
library behavior, consumer responsibility, or a named legal or live limit, and the English and
Spanish guides must remain aligned. This FAQ work does not reopen the completed
technical-publication ledger.

### Unresolved external verification

Controlled preproduction or consumer integration is still required for certificate eligibility and
authorization, real mTLS and network behavior, exact live state and error precedence, AEAT clock
tolerance, decimal lexical treatment in hash comparison, query authorization and pagination under
concurrency, the complete QR lookup-response surface, and physical invoice render-and-scan checks.
Production calls are not required to maintain the offline ledger.

### Existing live evidence

The preproduction workflow's manual `consult` and alta-plus-consulta checks succeeded on
2026-09-22, including comparison of AEAT's stored hash with the submitted hash. Its monthly schedule
is enabled. The test environment uses the certificate company's identity for both issuer and
software producer until a producer NIF exists. The expanded monthly sequence covers both submit
record types, every consulta filter and header form available to the configured representative
certificate, and the JSON QR lookup. Verify that complete sequence manually after it lands.

The initial manual mixed-regime probe succeeded on 2026-09-23 with `EstadoEnvio: Correcto` and
`EstadoRegistro: Correcto`, with no error code or description. Its `CuotaTotal` matched all lines,
while its `ImporteTotal` matched only the ordinary regime `01` line. That result was inconclusive
because it also fitted a hybrid interpretation in which AEAT checked each total against a different
set of lines.

The [conclusive follow-up run](https://github.com/waitron-io/verifactu/actions/runs/35857557571)
submitted `CuotaTotal: 999.00` and `ImporteTotal: 999.00`, more than €10 away from both the complete
`01` + `03` desglose and its regime `01` line alone. AEAT returned `EstadoEnvio: Correcto` and
`EstadoRegistro: Correcto`, with no error code or description. This proves that a regime `03` line
suppresses both total cross-checks for the complete mixed record. The validator applies the same
record-wide gate to the other exclusion codes that §3.1.3.16–17 lists with `03`; the subsequent
runs below establish every listed code.

The [`05` run](https://github.com/waitron-io/verifactu/actions/runs/35864290069) and [`09`
run](https://github.com/waitron-io/verifactu/actions/runs/35864701279) used the same deliberately
incorrect totals and both returned `EstadoEnvio: Correcto` and `EstadoRegistro: Correcto`, with no
error code or description. The first [`06`
run](https://github.com/waitron-io/verifactu/actions/runs/35864396165) returned `EstadoEnvio:
Incorrecto`, `EstadoRegistro: Incorrecto`, and error 1202 because the regime line omitted the
required `BaseImponibleACoste`. That rejection confirms the prerequisite in §3.1.3.15.6.4 but says
nothing about the total checks.

The corrected runs for [`06`](https://github.com/waitron-io/verifactu/actions/runs/35868064280) and
[`08`](https://github.com/waitron-io/verifactu/actions/runs/35868173896) supplied the required
regime-specific fields: `BaseImponibleACoste` for `06`, and an `N2` line without tax-rate or
charged-tax fields for `08`. Both retained deliberately incorrect totals and returned `EstadoEnvio:
Correcto` and `EstadoRegistro: Correcto`, with no error code or description. Together with the
earlier runs, this live-verifies the record-wide suppression for every exclusion code listed by
§3.1.3.16–17: `03`, `05`, `06`, `08`, and `09`.

Read-only issuer consultas then retrieved those five historical records by their exact serial and
issue date. These consultas did not submit replacement records. Every record remained `Correcto`,
and AEAT returned every requested field. The stored hash matched the originally submitted hash in
each case, while both totals and every breakdown field matched by value:

| Regime | Retrieval evidence                                                                  | Matching stored hash                                               |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `03`   | [Run 35877525598](https://github.com/waitron-io/verifactu/actions/runs/35877525598) | `9F61B0D9581599ECB1230B625F7E7FDD07A80CA11BA812DF1DFE2BE8F0F8DF9B` |
| `05`   | [Run 35877518587](https://github.com/waitron-io/verifactu/actions/runs/35877518587) | `2D303F331C20E4DC8A5D7AC6B02DCB513D13242FF0D2590275405CA3F3BC6CF6` |
| `06`   | [Run 35877524559](https://github.com/waitron-io/verifactu/actions/runs/35877524559) | `4D3E9E7B6CEEE14E91066FBC09E08F83CEB927BCD0E2210BDEA4CC1B9A739721` |
| `08`   | [Run 35877522333](https://github.com/waitron-io/verifactu/actions/runs/35877522333) | `265D6547765E52C77C25631C25FEA4D1AAB16D4A0711DA619A3D75331DADA12D` |
| `09`   | [Run 35877523639](https://github.com/waitron-io/verifactu/actions/runs/35877523639) | `A53F2A7E8B79025584D7B4F03C7FB10EF0F6BEF0E323B94B9365B0F937FCD599` |

AEAT reformatted decimal values in the consulta response, for example returning `999` for the
submitted `999.00`, `21` for `21.00`, and `100` for `100.00`. The comparison therefore checks the
numeric value of schema-decimal fields while keeping tax, regime, classification, and exemption
codes as exact strings. The raw submitted and stored representations remain in each workflow log.
