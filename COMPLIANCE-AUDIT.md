# Veri*Factu compliance audit

This is the working record for checking this library against AEAT's published rules. A passing
local test confirms the stated library behaviour; only AEAT can confirm that a submitted record
is accepted. The [source watch](sources/README.md) checks for publication changes each week.

## Sources checked through 25 September 2026

| AEAT publication                                                                                                                                                   | Version                                    | Audit status                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Validation rules and errors](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf)          | 1.2.2, 8 April 2026                        | In progress; §§3.1.1–3.1.5 substantially checked, §§4–6 partial                                                                                             |
| [Web service description](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf)             | 1.0.3, 28 July 2025                        | In progress; section coverage map below                                                                                                                     |
| [Hash specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf) | 0.1.2, 27 August 2024                      | §§2–7 checked for alta and cancellation; event records out of scope; decimal-variant comparison pending AEAT preproduction                                  |
| [QR specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf)               | 0.5.0, 10 December 2025                    | §§2–10 and 12 classified; verifiable QR URL rules checked; printed layout and lookup responses outside library scope                                        |
| [Developer FAQ](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf)                              | 1.3, 4 December 2025                       | Pending entry-by-entry review                                                                                                                               |
| [Public FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html)                                 | Pages listed by AEAT on 22 September 2026  | Pending entry-by-entry review                                                                                                                               |
| [XSD and WSDL files](schemas/README.md)                                                                                                                            | Versions and checksums in the linked index | Filing record, `SuministroLR.xsd`, `ConsultaLR.xsd`, and `RespuestaSuministro.xsd` inventories complete; consultation response and cross-schema review open |

## Web-service description coverage map

The 101-page service description is not yet a completed audit. This map distinguishes a checked
rule from a section whose examples or tables still need line-by-line comparison.

| Section                                                        | Checked here or in earlier branches                                                                  | Still to check                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| §§1–2: introduction and revision history                       | Published version and intended voluntary/under-requirement modes identified                          | Reconcile each revision note with the bundled schemas and current behavior            |
| §3: operating model                                            | Global and per-line statuses, CSV absence on complete rejection, and mode-specific correction advice | Remaining diagram and edge cases against the request/response paths                   |
| §§4–5: standards, transport, faults                            | SOAP 1.1 document/literal, UTF-8, HTTPS/certificate responsibility, and fault retry guidance         | Real certificate and transport acceptance in AEAT preproduction                       |
| §§6.1–6.6: messages, consultation, response, code lists, modes | Selected header/wrapper, consulta, response, flow-control, and endpoint rules recorded below         | All remaining message diagrams, field tables, pagination rules, and code-list entries |
| §§6.7–6.9: text and numeric XML                                | Whitespace, leading-zero, and escaping rules recorded below                                          | AEAT's exact Unicode trim boundary needs a controlled live probe                      |
| §§7–8: test and production annexes                             | All eight WSDL service ports, two bindings, and four messages checked against the client             | Remaining annex links and XSD elements in both environments                           |
| §§9–11: worked operating flows                                 | Selected voluntary/requirement correction policy and consulta behavior                               | Every worked XML example and remaining flow variant                                   |

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

The source watch on 25 September 2026 reported that every watched publication still matched its
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
future-dated `AceptadoConErrores` line, a mixed batch, an all-rejected two-line batch,
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

The WSDL assigns four ports to each binding: ordinary and sello-certificate addresses in both
production and preproduction. `SistemaVerifactu`, `SistemaVerifactuSello`,
`SistemaVerifactuPruebas`, and `SistemaVerifactuSelloPruebas` match `SOAP_ENDPOINTS` and
`SOAP_ENDPOINTS_SELLO`; the four corresponding `SistemaRequerimiento` ports match
`SOAP_ENDPOINTS_REQUERIMIENTO` and `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO`. `src/endpoints.test.ts`
pins all eight full URLs. `xmllint --nonet --noout` accepted the bundled WSDL, and XPath counts
confirmed five imports, four messages, two bindings, and eight ports. The focused endpoint,
client, source-file, and XSD tests passed 44 cases. `createClient` still accepts any caller-supplied
endpoint and cannot prevent consulta being sent to a requirement-only URL; select the voluntary
endpoint for consulta. WSDL structure and local tests do not prove certificate authorization,
live service acceptance, or element-by-element conformance of every XSD type.

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
rejects incomplete invoice identities inside returned records. Focused tests cover valid final
and continuing pages, malformed flags, missing or repeated elements, and blank identity fields.
This is a response-boundary check, not whole-response XSD validation; AEAT preproduction remains
the source of actual responses.

### Consultation response fields — service description §6.4.2 and `RespuestaConsultaLR.xsd`

The response schema requires `Cabecera`, `PeriodoImputacion`, `IndicadorPaginacion`, and
`ResultadoConsulta` in that order. It allows up to 10,000 records followed by an optional
`ClavePaginacion`. `parseRespuestaConsulta` is a projection of this response, not a complete
schema validator: it exposes the two flags, a continuation cursor when the flag is `S`, and the
record list, but it does not expose or validate the echoed header and period or enforce the page
size. A minimal response with one record and a continuation cursor passes offline validation
against the pinned response XSD and its imports; that does not establish every returned field or
live AEAT behavior.

| Published record field                                    | Parser behavior                                                                                                                                            | Evidence and limit                                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDFactura`                                               | Returns its three identity fields and rejects an absent, repeated, incomplete, or XSD-invalid NIF length, invoice-number length, or date shape             | Parser tests and offline response-XSD probes; one invalid record aborts the entire parsed page, while calendar validity and NIF control remain separate |
| `DatosRegistroFacturacion`                                | Retains the stored subtree and literal string values, including hash and amount fields; a present empty block becomes `{}` and an absent block is rejected | `src/xml/parse-consulta.test.ts`; nested data fields, limits, and combinations are not validated                                                        |
| `DatosPresentacion`                                       | Returns its three fields when present; rejects repeated blocks, missing fields, invalid NIF length, and overlong petition ID                               | Parser tests and offline response-XSD probes; date-time syntax is not validated                                                                         |
| `EstadoRegistro.TimestampUltimaModificacion`              | Returns the required timestamp literal; rejects a missing or blank value                                                                                   | `src/xml/parse-consulta.test.ts`; date-time syntax is not validated                                                                                     |
| `EstadoRegistro.EstadoRegistro` and optional error detail | Checks the status against `Correcto`, `AceptadoConErrores`, and `Anulado`; converts an error code to a number and returns its description                  | `src/xml/parse-consulta.test.ts`; the consultation-response audit still needs to apply the response XSD's integer lexical and exact-range checks        |

The required-block check prevents a malformed response from returning `undefined` where the
public `RegistroConsultado` type promises an object or timestamp. It does not establish that an
actual AEAT response contains all fields; that still needs a preproduction observation.
For a continuing page, `ClavePaginacion` receives the same NIF-length, invoice-number, and date
shape checks as `IDFactura`, so a malformed cursor fails at the response boundary instead of
being returned for a later request that would reject it. The parser still ignores an unexpected
cursor on a final page, preserving its records. The optional `DatosPresentacion` block now requires
all three XSD fields when present, while retaining literal timestamp text; it does not claim to
validate the full XML Schema `dateTime` lexical space.
Unlike an ignored final-page cursor, a malformed record identity causes parsing to fail for the
whole response. The API does not return that page's other records or cursor in this case; callers
who need to diagnose non-conforming AEAT XML must capture the raw response at their transport
boundary.

### Own-record hash validation

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
XML boundaries are covered in `src/validate.test.ts`. The three AEAT examples are checked directly
in `src/conformance.test.ts` and through third-party fixtures in `src/upstream-conformance.test.ts`.
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
build or submit event records, so those fields are explicitly outside its supported surface.

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

### QR URL and printed presentation — QR specification §§2–10, 12

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
from it. The helper therefore adds neither option. The non-verifiable `/ValidarQRNoVerifactu`
URLs in §5.2 and §8, and the HTML/JSON lookup responses and errors in §§9–10, are outside this
library's public QR helper. It does not claim to parse or classify those responses.

The image requirements in §§2–3 and the printed examples in §12 belong to the invoice renderer:
ISO/IEC 18004:2015, 30–40 mm square, error-correction level M, at least 2 mm clear space on each side (6 mm
recommended), prominent placement before content on the first page, `QR tributario:` above, and
the prescribed verifiable-invoice wording below. The English and Spanish QR guides now state
these requirements. Their render/decode example proves payload round-tripping, not physical
dimensions, placement, or print contrast. Section 11 cites the governing law but adds no
separate URL-format rule.

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

This is not full annex §6 fidelity. The fake still does not track the history needed for
`RechazoPrevio: "S"` after a rejected subsanación or cancellation, and it does not yet
implement every §6.2 state. The library
does not select a correction operation for callers;
check those flows against AEAT preproduction rather than treating the fake as an authority.

## Remaining work

Review every numbered validation rule, every service and hash/QR requirement, the consultation
response XSD and cross-schema WSDL constraints, and every developer and public FAQ entry. For each rule, add a
row with the exact source section, implementation, behavioural test, and any intentional scope
limit. Check the English and Spanish guides against each finding. The audit remains open until
this review is complete.

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
