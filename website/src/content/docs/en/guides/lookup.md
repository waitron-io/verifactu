---
title: Looking up records
description: Ask AEAT what it holds for an invoice or a month.
---

Look a record up when a result was unclear, such as after a timeout or a `duplicate_unknown`
result, and compare AEAT's fingerprint with yours. AEAT calls this a _consulta_.

## Look up one invoice

Every lookup needs a year and month (`Ejercicio` and `Periodo`). Use the month of the operation
date (`FechaOperacion`) if the record has one, and otherwise the month of the issue date. Write the
month with two digits, such as `"07"`.

```ts
const result = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: record.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
});

for (const stored of result.registros) {
  console.log(stored.IDFactura.NumSerieFactura, stored.EstadoRegistro); // T01/000123 Correcto
  console.log(stored.DatosRegistroFacturacion.Huella === record.Huella); // true
}
```

If you use the wrong month, AEAT finds nothing, even when the invoice number is right.

## Narrow or widen the search

Leave out the invoice number and date to get every record for the month. You can also filter by:

- `RangoFechaExpedicion: { Desde, Hasta }`, a range of issue dates, written `DD-MM-YYYY`
- `Contraparte`, the customer
- `RefExterna`, your own reference
- `SistemaInformatico`, one installation of your software

Add `DatosAdicionalesRespuesta` if you also want the seller's name or software details in each
result. AEAT warns that this makes the lookup slower.

## Get every page

A month can return more records than fit in one reply. When `IndicadorPaginacion` is `"S"`, pass
the reply's `ClavePaginacion` back in your next lookup:

```ts
import type { RegistroConsultado } from "@waitron/verifactu";

const month = { Ejercicio: "2026", Periodo: "07" };
const all: RegistroConsultado[] = [];
let page = await client.consultar(cabecera, month);
all.push(...page.registros);

while (page.IndicadorPaginacion === "S") {
  page = await client.consultar(cabecera, { ...month, ClavePaginacion: page.ClavePaginacion });
  all.push(...page.registros);
}

console.log(all.length); // 1
```

## Invoices issued to you

A customer can look up invoices issued to them. Put the customer in the header as `Destinatario`,
and the seller in `Contraparte`:

```ts
const received = await client.consultar(
  { Destinatario: { NombreRazon: "Customer SL", NIF: "B12345674" } },
  { Ejercicio: "2026", Periodo: "07", Contraparte: seller },
);

console.log(received.ResultadoConsulta); // SinDatos
```

## What a lookup can't do

- It doesn't return the receipt (`CSV`) from the original send.
- It can't find records you sent because AEAT asked for them (a _requerimiento_).
