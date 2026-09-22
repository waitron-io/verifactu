---
title: Consultar a la AEAT
description: Busca una factura o recorre los registros de un periodo.
---

Usa `consultar` para comparar tu copia con el registro guardado por la AEAT, especialmente después
de una respuesta de duplicado sin detalle del estado almacenado. El periodo es obligatorio incluso
si conoces el número de factura.

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

`NumSerieFactura` y `FechaExpedicionFactura` acotan la consulta; omítelos para recorrer el
periodo. Cuando `IndicadorPaginacion` sea `"S"`, envía la `ClavePaginacion` recibida en la
siguiente consulta. El CSV del envío no se puede recuperar aquí: la consulta no lo devuelve.
