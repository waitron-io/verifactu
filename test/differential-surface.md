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

The reference's version `1.5.3` does not emit `Subsanacion`, `RechazoPrevio`,
`Macrodato` or `Cupon` in alta XML, or `RefExterna`, `SinRegistroPrevio`,
`RechazoPrevio` or `GeneradoPor` in anulación XML. Keep those fields covered
by this package's direct serializer and schema tests; do not treat an unequal
reference output as evidence they should be removed.

## Remaining

- **Consulta request XML:** Compare `serializeConsulta(cabecera, filtro)` with
  `consultaXml(cabecera, filtro)`. Map the reference's lowercase filter names
  to this package's AEAT field names, then compare XML structure as above.
  Include pagination and optional filters.
- **Submission and consulta responses:** Compare the common fields from
  `parseRespuestaSuministro` and `parseRespuestaConsulta` with the reference's
  `parseRespuesta`: status, CSV, invoice serial, record status and error
  details. The reference result is shallow and includes transport metadata;
  this package also exposes typed detail and pagination. Test accepted,
  rejected, duplicate and paginated responses separately.

`parseEnvio`, `parseConsulta` and `resolveEstadoEfectivo` have no matching
reference API. Keep their existing direct tests. Do not compare SOAP clients by
sending live requests as part of this suite.
