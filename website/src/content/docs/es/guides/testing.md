---
title: Pruebas
description: Prueba todo tu flujo contra una copia de la AEAT que funciona sin conexión.
---

`@waitron/verifactu/testing` incluye una copia sin conexión del servicio de la AEAT. Lee el mismo XML
que el servicio real y responde como lo hace la AEAT, así que tus pruebas usan el cliente real de la
biblioteca sin certificado ni red.

## Envía a la AEAT sin conexión

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = aeat.client();

const reply = await client.submit(cabecera, [{ RegistroAlta: record }]);
console.log(reply.CSV); // CSV-00000001
console.log(aeat.stored().length); // 1
```

Su reloj está fijado en el 21 de julio de 2026 salvo que pases `serverNow`, así tus pruebas dan el
mismo resultado de un día a otro. Como la AEAT, rechaza una factura con fecha posterior a su reloj.
Mueve el reloj durante una prueba con `aeat.setServerNow(date)`.

Si tu código crea su propio cliente, pásale `aeat.fetch` en lugar del fetch que usa tu certificado:

```ts
import { createClient } from "@waitron/verifactu";

const yourClient = createClient({ endpoint: "https://aeat.test/", fetch: aeat.fetch });
```

## Haz que la AEAT falle

Úsalas para probar cómo trata tu código cada tipo de resultado. Cada una recibe la clave de la
factura, que obtienes con `keyOf(record)`.

| Llamada                                 | Qué pasa                                                           |
| --------------------------------------- | ------------------------------------------------------------------ |
| `aeat.reject(key, code, message)`       | Cada envío de esa factura se rechaza con tu código de error.       |
| `aeat.dropRegistroDuplicadoDetail(key)` | Un reenvío se da como duplicado, sin detalles.                     |
| `aeat.annul(key)`                       | La factura guardada se marca como anulada.                         |
| `aeat.forget(key)`                      | La AEAT pierde la factura, así que una consulta no encuentra nada. |

```ts
import { keyOf } from "@waitron/verifactu/testing";
import { buildAltaRecord, resolveEstadoEfectivo } from "@waitron/verifactu";

const next = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: { RegistroAnterior: { ...record.IDFactura, Huella: record.Huella } },
});
aeat.reject(keyOf(next), 1100, "Test rejection");

const rejected = await client.submit(cabecera, [{ RegistroAlta: next }]);
console.log(resolveEstadoEfectivo(rejected.RespuestaLinea[0])); // rejected
```

## Lo que no demuestra

La AEAT sin conexión sigue muchas de las reglas que publica la AEAT y lo que hemos visto hacer al
servicio real. Aun así, es una copia. Antes de empezar a funcionar en real, prueba con tu
certificado real contra el entorno de pruebas de la AEAT (preproducción).

Además, no:

- comprueba que cada registro enlaza con el registro anterior real
- separa de los normales los registros enviados porque la AEAT los pidió (un requerimiento)
