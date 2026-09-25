---
title: Query AEAT
description: Look up an invoice or sweep a period of stored records.
---

Use `consultar` when you need to reconcile your copy with AEAT's stored record, especially after a
duplicate response with no stored-state detail. The period is mandatory even when you know the
invoice number.

```ts
const result = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: record.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
});

for (const stored of result.registros) {
  console.log(stored.IDFactura, stored.EstadoRegistro);
  console.log(stored.DatosRegistroFacturacion.Huella);
}

const detailed = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  SistemaInformatico: {
    NombreRazon: sistema.NombreRazon,
    NIF: sistema.NIF,
    IdSistemaInformatico: sistema.IdSistemaInformatico,
    NumeroInstalacion: sistema.NumeroInstalacion,
  },
  DatosAdicionalesRespuesta: {
    MostrarNombreRazonEmisor: "S",
    MostrarSistemaInformatico: "S",
  },
});
console.log(detailed.registros[0]?.DatosRegistroFacturacion.NombreRazonEmisor); // Example SL
console.log(Boolean(detailed.registros[0]?.DatosRegistroFacturacion.SistemaInformatico)); // true

const received = await client.consultar(
  { Destinatario: { NombreRazon: "Customer SL", NIF: "B12345674" } },
  {
    Ejercicio: "2026",
    Periodo: "07",
    Contraparte: cabecera.ObligadoEmision,
    RangoFechaExpedicion: { Desde: "01-07-2026", Hasta: "31-07-2026" },
  },
);
```

Give `Ejercicio` a four-digit year and `Periodo` a zero-padded month from `"01"` through `"12"`,
as in the query above. The client rejects either field when it has the wrong shape before sending
XML to AEAT. If you derive the month from a date, pad it to two digits rather than sending `"7"`.

`NumSerieFactura` and `FechaExpedicionFactura` narrow the query; omit them to sweep the period.
Use `RangoFechaExpedicion` with `Desde` and `Hasta` when you need a date range. It is an
alternative to `FechaExpedicionFactura`; the serializer rejects a request that sends both.
Write each date as `DD-MM-YYYY`, including the date in `ClavePaginacion`. The client checks this
shape before sending, and the raw request parser checks it when reading XML. A date such as
`31-02-2026` has the right shape but is not a real day; check calendar validity in your application.
Keep `NumSerieFactura` between 1 and 60 characters. Use `RefExterna` when you stored your own
reference on the record; it may be empty but cannot exceed 60 characters. The client checks these
limits, including the invoice number in `ClavePaginacion`, before sending because AEAT's request
schema rejects longer values.
`ClavePaginacion.IDEmisorFactura` must contain a nine-character NIF; the client checks its length
before sending.

Use `Contraparte` with the customer's `NombreRazon` and either `NIF` or `IDOtro` when you need
that customer's records.
`SistemaInformatico` narrows the result to one software installation. Supply `NombreRazon`, either
`NIF` or `IDOtro`, `IdSistemaInformatico`, and `NumeroInstalacion`. The software name, version, and
use flags are optional.
The client checks these identities and the schema's text lengths before sending. For `IDOtro`,
use an AEAT country code and an identifier type from `02` to `07`. Supply either issuer or
recipient in the consultation header, never both.

Request `DatosAdicionalesRespuesta` only when you need the issuer's name or software details in
each result. AEAT's `ConsultaLR.xsd` says these fields can slow its response. The same schema
requires recipient queries to omit `MostrarSistemaInformatico` or set it to `"N"`; its imported
`SuministroInformacion.xsd` restricts both options to `"S"` or `"N"`. The client rejects other
values before sending and places valid options after `FiltroConsulta` in the XML request.

A recipient uses a different consulta header. Include the issuer as `Contraparte` when you want
to target it, as the `received` query above demonstrates. In the schema annotation, `Obligado` and
`Destinatario` name the party whose identity belongs in this block; they do not make the block
mandatory. The XSD leaves `Contraparte` optional, and so does the library. This establishes the XML
shape, not which broad recipient queries AEAT authorizes. Check that behavior in preproduction
before relying on an omitted counterparty.

Set `IndicadorRepresentante: "S"` alongside `ObligadoEmision` when the certificate holder queries
as that issuer's representative. `"N"` is not a valid consultation value; omit the flag when the
query is not on behalf of a representative. Do not include it in a recipient query.

When `IndicadorPaginacion` is `"S"`, send `ClavePaginacion` from the response in your next query.
The response parser checks that `ResultadoConsulta` is `ConDatos` or `SinDatos`, that
`IndicadorPaginacion` is `S` or `N`, and that a continuing `S` page has one cursor with all three
invoice-identity fields present and within the schema's NIF, invoice-number, and date-shape bounds.
It applies those same bounds to each returned invoice identity. It throws if a continuing cursor
is missing or malformed, so you do not repeat the first page. A final `N` page needs no cursor;
if the response includes one anyway, the parser ignores it and keeps the page's records. It also
rejects a response containing more than the schema's 10,000 records.
If a record includes `DatosPresentacion`, the parser requires its presenter NIF, presentation
timestamp, and petition ID elements. The schema allows an empty petition ID. The parser preserves
the timestamp text after checking its XML Schema date-time form. It applies the same check to the
record's required last-modified timestamp. Error codes must use integer text and fit JavaScript's
exact integer range; error descriptions may contain at most 500 characters.
If any returned record has a malformed invoice identity, parsing fails for the whole page; you
do not get its other records or cursor. Capture the raw response in your transport layer if you
need to diagnose a non-conforming AEAT response.
Do not try to recover a submission's CSV here: consulta does not return it.
