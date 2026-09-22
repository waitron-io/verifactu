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
```

`NumSerieFactura` and `FechaExpedicionFactura` narrow the query; omit them to sweep the period.
Use `RefExterna` when you stored your own reference on the record. Use `Contraparte` with the
customer's `NombreRazon` and either `NIF` or `IDOtro` when you need that customer's records.
`SistemaInformatico` narrows the result to one software installation. Its name, identity, system
ID, and installation number are required; you can also supply its version and use flags.

Request `DatosAdicionalesRespuesta` only when you need the issuer's name or software details in
each result. The extra fields can slow AEAT's response. If you query as a recipient, leave
`MostrarSistemaInformatico` out or set it to `"N"`, as AEAT requires. The client places these
options after `FiltroConsulta` in the XML request.

When `IndicadorPaginacion` is `"S"`, send `ClavePaginacion` from the response in your next query.
Do not try to recover a submission's CSV here: consulta does not return it.
