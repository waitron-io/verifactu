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

Give `Periodo` a zero-padded month from `"01"` through `"12"`, as in the `"07"` query above.
The client rejects an invalid value before sending XML to AEAT. If you derive the month from a
date, pad it to two digits rather than sending `"7"`.

`NumSerieFactura` and `FechaExpedicionFactura` narrow the query; omit them to sweep the period.
Use `RangoFechaExpedicion` with `Desde` and `Hasta` when you need a date range. It is an
alternative to `FechaExpedicionFactura`; the serializer rejects a request that sends both.
Use `RefExterna` when you stored your own reference on the record. Use `Contraparte` with the
customer's `NombreRazon` and either `NIF` or `IDOtro` when you need that customer's records.
`SistemaInformatico` narrows the result to one software installation. Supply `NombreRazon`, either
`NIF` or `IDOtro`, `IdSistemaInformatico`, and `NumeroInstalacion`. The software name, version, and
use flags are optional.

Request `DatosAdicionalesRespuesta` only when you need the issuer's name or software details in
each result. AEAT's `ConsultaLR.xsd` says these fields can slow its response. The same schema
requires recipient queries to omit `MostrarSistemaInformatico` or set it to `"N"`. The client
places these options after `FiltroConsulta` in the XML request.

A recipient uses a different consulta header and identifies the issuer as the counterparty, as the
`received` query above demonstrates.

Set `IndicadorRepresentante: "S"` alongside `ObligadoEmision` when the certificate holder queries
as that issuer's representative. `"N"` is not a valid consultation value; omit the flag when the
query is not on behalf of a representative. Do not include it in a recipient query.

When `IndicadorPaginacion` is `"S"`, send `ClavePaginacion` from the response in your next query.
Do not try to recover a submission's CSV here: consulta does not return it.
