# Provenance

This library implements Spain's Veri\*Factu specification (RD 1007/2023, Orden HAC/1177/2024)
from AEAT's published technical documentation. Two independent implementations of a published
government specification are not derivative of each other.

## Implemented from

| Document                                                                                             | Version           |
| ---------------------------------------------------------------------------------------------------- | ----------------- |
| AEAT, especificaciones técnicas huella/hash de los registros de facturación                          | 0.1.2, 27/08/2024 |
| AEAT, especificaciones técnicas del código QR y URL de cotejo                                        | 0.5.0             |
| AEAT, Descripción del servicio web                                                                   | 1.0.3             |
| AEAT, Validaciones y errores                                                                         | 1.2.2             |
| AEAT, FAQs Desarrolladores                                                                           | 04/12/2025        |
| AEAT XSDs: SuministroInformacion, SuministroLR, RespuestaSuministro, ConsultaLR, RespuestaConsultaLR | v1.0              |
| AEAT `SistemaFacturacion.wsdl`                                                                       | —                 |
| Orden HAC/1177/2024 (BOE-A-2024-22138), arts. 7, 13, 16                                              | consolidated      |

## Primary sources on disk

The XSDs and the WSDL listed above are committed verbatim in [`schemas/`](schemas/), with fetch
dates, source URLs and SHA-256 checksums in [`schemas/README.md`](schemas/README.md).

## References consulted

- `borjamrd/verifactu-conformance` (MIT) — third-party JSON packaging of AEAT's published
  examples, pinned at commit `e654c97a1dcc877dc2931a148413284757d7a072` in
  [`test/upstream/`](test/upstream/). The three hash examples and supported valid QR examples
  are exercised in `src/upstream-conformance.test.ts`. AEAT's PDFs, not this repository, are
  authoritative; derived cases in its QR fixture are labelled separately.
- `inoguerols/verifactu` (MIT) — consulted as a reference implementation.

The [source watch](sources/README.md) checks these repositories and AEAT publications weekly.

## Not consulted

`mdiago/VeriFactu` is AGPL-3.0. **Its source was not read.** It may be used only as a black-box
differential oracle — executing the binary and comparing output is comparing behaviour, not
copying expression.

## Disclaimer

This library is a tool for building SIFs. **It is not itself a SIF.** A _sistema informático de
facturación_ is a deployed system, and its obligations are properties of the selected operating
mode and deployment, not of source code. AEAT developer FAQ 13 says local conservation of
submitted records is not separately regulated for a Veri*Factu SIF because AEAT retains them; the
deployment still owns durable numbering, chain and retry state, AEAT receipts, complete invoice
documents, and any storage required by its wider accounting system. The producer that integrates
this library into a deployed product is responsible for the declaración responsable that applies
to that product's components and architecture.
