# Veri*Factu compliance audit

This is the working record for checking this library against AEAT's published rules. A passing
local test confirms the stated library behaviour; only AEAT can confirm that a submitted record
is accepted. The [source watch](sources/README.md) checks for publication changes each week.

## Sources checked on 22 September 2026

| AEAT publication                                                                                                                                                   | Version                                    | Audit status                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- |
| [Validation rules and errors](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf)          | 1.2.2, 8 April 2026                        | In progress; selected rules below                                          |
| [Web service description](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf)             | 1.0.3, 28 July 2025                        | Pending systematic review                                                  |
| [Hash specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf) | 0.1.2, 27 August 2024                      | Three published examples checked; remaining prose pending review           |
| [QR specification](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf)               | 0.5.0, 10 December 2025                    | Three supported published examples checked; remaining prose pending review |
| [Developer FAQ](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf)                              | 1.3, 4 December 2025                       | Pending entry-by-entry review                                              |
| [Public FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html)                                 | Pages listed by AEAT on 22 September 2026  | Pending entry-by-entry review                                              |
| [XSD and WSDL files](schemas/README.md)                                                                                                                            | Versions and checksums in the linked index | Pending element-by-element review                                          |

## Rules checked in this branch

| Rule                                                                                                   | Library check                                                                                               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Limit                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Validation §3.1.3.13: recipients required for `F1`, `F3`, `R1`–`R4`, forbidden for `F2`, `R5`          | `DESTINATARIOS_REQUIRED` and `DESTINATARIOS_FORBIDDEN` in `validate`                                        | Type-specific cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Recipient NIF registration is checked by AEAT, not locally                                                                         |
| Validation §3.1.3.15.6: `ClaveRegimen` required for IVA, IPSI and IGIC, forbidden for other taxes      | `CLAVE_REGIMEN_REQUIRED` and `CLAVE_REGIMEN_FORBIDDEN` in `validate`                                        | Missing and forbidden-field cases in `src/validate.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Code-list and combination rules in §15.6 remain to be audited                                                                      |
| Validation §3.1.3.16–17: total cross-checks allow €10 and exclude regimes `03`, `05`, `06`, `08`, `09` | `CUOTA_TOTAL_MISMATCH` and `IMPORTE_TOTAL_MISMATCH` warnings, skipped when any line uses an excluded regime | Tolerance boundary, pure-exclusion and mixed-regime cases in `src/validate.test.ts`; conclusive AEAT preproduction runs for [`03`](https://github.com/waitron-io/verifactu/actions/runs/35857557571), [`05`](https://github.com/waitron-io/verifactu/actions/runs/35864290069), [`06`](https://github.com/waitron-io/verifactu/actions/runs/35868064280), [`08`](https://github.com/waitron-io/verifactu/actions/runs/35868173896), and [`09`](https://github.com/waitron-io/verifactu/actions/runs/35864701279) | Each published exclusion code has one live-verified mixed-regime shape; other line shapes remain subject to their own regime rules |
| Hash specification examples                                                                            | Canonicalization and `computeHuella` match three published examples                                         | `src/upstream-conformance.test.ts`, fixtures in `test/upstream/`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The fixtures are packaged by a third party; AEAT's PDF is authoritative                                                            |
| QR specification examples                                                                              | QR URL helper matches three supported published examples                                                    | `src/upstream-conformance.test.ts`, fixtures in `test/upstream/`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Further QR cases and rendering details remain to be audited                                                                        |

## Remaining work

Review every numbered validation rule, every service and hash/QR requirement, each XSD/WSDL
element and ordering constraint, and every developer and public FAQ entry. For each rule, add a
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
