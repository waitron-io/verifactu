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
```

`NumSerieFactura` and `FechaExpedicionFactura` narrow the query; omit them to sweep the period.
When `IndicadorPaginacion` is `"S"`, send `ClavePaginacion` from the response in your next query.
Do not try to recover a submission's CSV here: consulta does not return it.
