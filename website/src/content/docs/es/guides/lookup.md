---
title: Consultar registros
description: Pregunta a la AEAT qué tiene guardado de una factura o de un mes.
---

Consulta un registro cuando un resultado no quedó claro, por ejemplo tras agotarse el tiempo de
espera o tras un resultado `duplicate_unknown`, y compara la huella de la AEAT con la tuya. La AEAT
lo llama consulta.

## Consulta una factura

Toda consulta necesita un año y un mes (`Ejercicio` y `Periodo`). Usa el mes de la fecha de
operación (`FechaOperacion`) si el registro la tiene y, si no, el mes de la fecha de expedición.
Escribe el mes con dos dígitos, como `"07"`.

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

Si usas el mes equivocado, la AEAT no encuentra nada, aunque el número de factura sea correcto.

## Acota o amplía la búsqueda

Omite el número y la fecha de la factura para obtener todos los registros del mes. También puedes
filtrar por:

- `RangoFechaExpedicion: { Desde, Hasta }`, un rango de fechas de expedición, escritas `DD-MM-YYYY`
- `Contraparte`, el cliente
- `RefExterna`, tu propia referencia
- `SistemaInformatico`, una instalación de tu software

Añade `DatosAdicionalesRespuesta` si también quieres el nombre del emisor o los datos del software
en cada resultado. La AEAT avisa de que esto hace más lenta la consulta.

## Obtén todas las páginas

Un mes puede devolver más registros de los que caben en una respuesta. Cuando `IndicadorPaginacion`
es `"S"`, pasa la `ClavePaginacion` de la respuesta en tu siguiente consulta:

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

## Facturas emitidas a tu nombre

Un cliente puede consultar las facturas emitidas a su nombre. Pon al cliente en la cabecera como
`Destinatario`, y al emisor en `Contraparte`:

```ts
const received = await client.consultar(
  { Destinatario: { NombreRazon: "Customer SL", NIF: "B12345674" } },
  { Ejercicio: "2026", Periodo: "07", Contraparte: seller },
);

console.log(received.ResultadoConsulta); // SinDatos
```

## Lo que una consulta no puede hacer

- No devuelve el justificante (`CSV`) del envío original.
- No encuentra los registros que enviaste porque la AEAT te los pidió (un requerimiento).
