---
title: Crear y enviar con menos pasos
description: Usa la fachada sin estado y guarda los números de factura y la cadena de huellas en tu base de datos.
---

Tu aplicación debe elegir el siguiente número de factura y recordar el registro anterior. Con
esos valores, la fachada crea el alta y envía registros directamente, sin que tengas que preparar
las envolturas XML. La fachada no guarda el estado de la cadena.

Usa `sale`, `cabecera` y `certificateFetch`, configurado con tu certificado, de la
[guía de envío](/verifactu/es/guides/submit/). El primer registro no tiene antecesor. Para el
segundo, pasa los cuatro valores del primer registro que hayas guardado:

```ts
import { buildAlta, submitRecords } from "@waitron/verifactu/facade";

const first = buildAlta({ ...sale, NumSerieFactura: "T01/000123", previous: null });
const second = buildAlta({
  ...sale,
  NumSerieFactura: "T01/000124",
  previous: {
    IDEmisorFactura: first.IDFactura.IDEmisorFactura,
    NumSerieFactura: first.IDFactura.NumSerieFactura,
    FechaExpedicionFactura: first.IDFactura.FechaExpedicionFactura,
    Huella: first.Huella,
  },
});

for (const record of [first, second]) {
  if (validate(record).some((issue) => issue.severity === "error")) {
    throw new Error(`Factura inválida ${record.IDFactura.NumSerieFactura}`);
  }
}

const response = await submitRecords(
  { endpoint: SOAP_ENDPOINTS.preproduction, fetch: certificateFetch },
  cabecera,
  [first, second],
);
console.log(response.EstadoEnvio); // Correcto
```

`buildAlta` usa el mismo formato y cálculo de huella que `buildAltaRecord`. Guarda de forma
duradera el número asignado, el registro completo y la respuesta de la AEAT. Examina cada línea
de la respuesta y respeta el tiempo de espera antes de otro envío, como muestra la
[guía de envío](/verifactu/es/guides/submit/). `submitRecords` envía los registros en el orden que
indicas; no los valida, renumera ni reintenta.
