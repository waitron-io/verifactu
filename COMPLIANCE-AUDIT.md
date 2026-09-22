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

| Rule                                                                                                   | Library check                                                                           | Evidence                                                         | Limit                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Validation §3.1.3.13: recipients required for `F1`, `F3`, `R1`–`R4`, forbidden for `F2`, `R5`          | `DESTINATARIOS_REQUIRED` and `DESTINATARIOS_FORBIDDEN` in `validate`                    | Type-specific cases in `src/validate.test.ts`                    | Recipient NIF registration is checked by AEAT, not locally              |
| Validation §3.1.3.15.6: `ClaveRegimen` required for IVA, IPSI and IGIC, forbidden for other taxes      | `CLAVE_REGIMEN_REQUIRED` and `CLAVE_REGIMEN_FORBIDDEN` in `validate`                    | Missing and forbidden-field cases in `src/validate.test.ts`      | Code-list and combination rules in §15.6 remain to be audited           |
| Validation §3.1.3.16–17: total cross-checks allow €10 and exclude regimes `03`, `05`, `06`, `08`, `09` | `CUOTA_TOTAL_MISMATCH` and `IMPORTE_TOTAL_MISMATCH` warnings, skipped for those regimes | Tolerance boundary and exception cases in `src/validate.test.ts` | Other amount rules in §15 remain to be audited                          |
| Hash specification examples                                                                            | `buildAltaRecord` and hash helpers match three published examples                       | `src/upstream-conformance.test.ts`, fixtures in `test/upstream/` | The fixtures are packaged by a third party; AEAT's PDF is authoritative |
| QR specification examples                                                                              | QR URL helper matches three supported published examples                                | `src/upstream-conformance.test.ts`, fixtures in `test/upstream/` | Further QR cases and rendering details remain to be audited             |

## Remaining work

Review every numbered validation rule, every service and hash/QR requirement, each XSD/WSDL
element and ordering constraint, and every developer and public FAQ entry. For each rule, add a
row with the exact source section, implementation, behavioural test, and any intentional scope
limit. Check the English and Spanish guides against each finding. The audit remains open until
this review is complete.

The monthly preproduction workflow is built but has not run. A prior Waitron test authenticated
with the same certificate and received a `SinDatos` consultation response; it did not submit an
alta. The test environment uses the certificate company's identity for both issuer and software
producer until a producer NIF exists. Run this workflow's manual `consult` and `submit` checks
after merge, then enable its monthly schedule.
