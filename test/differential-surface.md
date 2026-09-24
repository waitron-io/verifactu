# Differential conformance surface

The test-only comparison pins `@inoguerols/verifactu` to version `1.5.3` in
`package.json` and `package-lock.json`. Review a version bump before accepting
any changed comparison result. AEAT's published examples in
`src/conformance.test.ts` and `test/vectors.ts` are authoritative; agreement
between two libraries is a way to find bugs, not proof of compliance. Resolve
each difference against an AEAT source and keep the resulting regression case.

## Covered

- **Alta and anulación hashes:** `src/differential.test.ts` passes the same
  canonical fields to this package's `buildCadenaAlta` and
  `buildCadenaAnulacion` and the reference's `cadenaAlta` and
  `cadenaAnulacion`. It compares official vectors, first and chained records,
  boundary amounts, and generated serials.
- **QR URL:** The adapter projects the four invoice literals from a record and
  maps `production` to `produccion` and `preproduction` to `pruebas`. Both
  environments and varied serials and amounts are tested.
- **Alta, anulación and batch XML:** `src/xml/differential.test.ts` maps the
  nested `ObligadoEmision` and `{ RegistroAlta }` / `{ RegistroAnulacion }` items
  to the reference's flat header and `{ alta }` / `{ anulacion }` items. It
  unwraps this package's SOAP envelope because the reference serializer
  returns only the `RegFactuSistemaFacturacion` payload. The comparison keeps
  expanded element and attribute names, ordered children and text values;
  namespace prefix and entity spelling may differ. Cases cover single records,
  mixed batches, the 1,000-record limit, rectification fields, a foreign
  recipient, escaped text and an empty optional field.
- **Consulta request XML:** `src/xml/differential-consulta.test.ts` compares
  period-only queries and pagination keys after mapping the reference's
  lowercase filter names to AEAT names. It checks this package's optional
  invoice serial and issue-date filters against the AEAT schema where the
  reference cannot produce equivalent XML.
- **Submission and consulta responses:** The same test compares common status,
  CSV, invoice serial and error fields for accepted, rejected and duplicate
  submissions, whole-request rejection, paginated consulta results with two
  records, and a consulta with no data. This package's typed duplicate detail
  and pagination key are asserted separately because the reference does not
  expose them.

The reference's version `1.5.3` does not emit `Subsanacion`, `RechazoPrevio`,
`Macrodato` or `Cupon` in alta XML, or `RefExterna`, `SinRegistroPrevio`,
`RechazoPrevio`, `GeneradoPor` or `Generador` in anulación XML. Keep those fields covered
by this package's direct serializer and schema tests; do not treat an unequal
reference output as evidence they should be removed.

## Reference gaps

- In `consultaXml`, the reference emits the filter's `NumSerieFactura` in the
  `SuministroInformacion.xsd` namespace. `ConsultaLR.xsd` declares it as a
  local element of `LRFiltroRegFacturacionType`, so this package emits it in
  the `ConsultaLR.xsd` namespace. The reference also cannot express this
  package's `FechaExpedicionFactura` filter.
- In `parseRespuesta`, the reference lets its XML parser coerce an all-digit
  invoice serial: `000123` becomes `123`. `SuministroInformacion.xsd` defines
  `TextoIDFacturaType` as a string, so this package preserves the leading
  zeroes. Do not normalize invoice serials to obtain agreement.
- The reference's response type has no consulta result, pagination indicator
  or key, typed duplicate detail, or complete stored record. Its transport
  metadata is outside this package's parser API. Compare only fields both
  libraries expose, and retain direct tests for the rest.

## Still outside the shared surface

`parseEnvio`, `parseConsulta` and `resolveEstadoEfectivo` have no matching
reference API. Keep their existing direct tests. Do not compare SOAP clients by
sending live requests as part of this suite.

The AEAT consulta schema also permits `Contraparte`, `SistemaInformatico`,
`RefExterna`, and `DatosAdicionalesRespuesta`. This package exposes them through
`ConsultaFiltro`. Direct serializer tests pin their XML structure, and request
variants with Spanish and foreign identities were validated against the
checked-in `ConsultaLR.xsd` with `xmllint`. The reference's filter adapter
cannot express them, so the shared comparison does not cover them.
