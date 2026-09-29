---
title: Entrega fiable
description: No pierdas nunca un registro, ni crees uno de más, entre emitir una factura y recibir la respuesta de la AEAT.
---

El momento delicado está entre emitir una factura y recibir la respuesta de la AEAT. Una caída o una
conexión cortada en ese punto no debe perder el registro, y un reintento no debe crear uno distinto.
La forma habitual de conseguirlo es una _bandeja de salida_ (outbox): una tabla de registros
pendientes de envío, guardada en la misma base de datos que los propios registros.

La biblioteca no incluye una base de datos ni una cola, así que los ejemplos siguientes usan
funciones que escribes tú.

## Guarda juntos el registro y su tarea

En una sola transacción de base de datos, reserva el siguiente número de factura, carga el último
registro, genera el nuevo, guárdalo y añádelo a la bandeja de salida. Si la transacción falla, no
existe ni el registro ni la tarea; si sale bien, existen los dos.

```ts
import { buildAlta } from "@waitron/verifactu/facade";
import type { RegistroAlta, RegistroAnterior } from "@waitron/verifactu";

interface Transaction {
  nextInvoiceNumber(): Promise<string>;
  latestRecord(): Promise<RegistroAnterior | null>;
  saveRecord(record: RegistroAlta): Promise<void>;
  addToOutbox(record: RegistroAlta): Promise<void>;
}

// Ejecuta `work` en una sola transacción de base de datos, con un bloqueo para este emisor. Esto lo escribes tú.
declare function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;

async function issue(): Promise<RegistroAlta> {
  return inTransaction(async (tx) => {
    const record = buildAlta({
      ...sale,
      NumSerieFactura: await tx.nextInvoiceNumber(),
      previous: await tx.latestRecord(),
    });
    await tx.saveRecord(record);
    await tx.addToOutbox(record);
    return record;
  });
}
```

Una vez guardado, un registro no cambia nunca. Cada intento posterior envía ese registro guardado;
nada vuelve a llamar a la función que lo genera.

## Envía una tarea cada vez

Da un estado a cada tarea y guarda el estado antes de enviar:

```ts
import {
  resolveEstadoEfectivo,
  type EstadoEfectivo,
  type VerifactuClient,
} from "@waitron/verifactu";

type JobState = "queued" | "sending" | "unknown" | EstadoEfectivo;
interface Job {
  record: RegistroAlta;
  state: JobState;
}

// Guarda el nuevo estado de la tarea en tu base de datos. Esto lo escribes tú.
declare function setJobState(job: Job, state: JobState): Promise<void>;

async function send(client: VerifactuClient, job: Job): Promise<void> {
  await setJobState(job, "sending");
  try {
    const reply = await client.submit(cabecera, [{ RegistroAlta: job.record }]);
    await saveReply(reply);
    await setJobState(job, resolveEstadoEfectivo(reply.RespuestaLinea[0]));
  } catch {
    await setJobState(job, "unknown");
  }
}

const job: Job = { record: await issue(), state: "queued" };
await send(client, job);
console.log(job.state); // accepted
```

Además:

- **Tras una caída, una tarea que siga marcada como `sending` pasa a `unknown`.** El envío puede
  haber llegado a la AEAT o no.
- **Envía una sola tarea cada vez por emisor e instalación**, en el orden en que las creaste, y
  espera entre envíos el tiempo que te indique la AEAT (`TiempoEsperaEnvio`).
- **Mientras una tarea esté en `unknown`, retén las siguientes de ese emisor** hasta saber qué le
  pasó.
- **Resuelve una tarea `unknown`** como se explica en
  [La respuesta de la AEAT](/verifactu/es/guides/replies/#después-de-un-fallo): vuelve a enviar el
  mismo registro guardado hasta recibir respuesta.

## Prueba una respuesta perdida

El peor caso es que la AEAT guarde un registro y la respuesta no llegue nunca. Puedes reproducirlo
con la AEAT sin conexión envolviendo su `fetch`:

```ts
import { createClient, SOAP_ENDPOINTS } from "@waitron/verifactu";

const losesReply: typeof fetch = async (url, init) => {
  await aeat.fetch(url, init); // La AEAT guarda el registro...
  throw new TypeError("connection reset"); // ...pero la respuesta nunca llega
};
const unreliable = createClient({ endpoint: SOAP_ENDPOINTS.preproduction, fetch: losesReply });

const lostJob: Job = { record: await issue(), state: "queued" };
await send(unreliable, lostJob);
console.log(lostJob.state); // unknown

const found = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: lostJob.record.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: lostJob.record.IDFactura.FechaExpedicionFactura,
});
console.log(found.registros[0]?.DatosRegistroFacturacion.Huella === lostJob.record.Huella); // true
```

Aquí `aeat` es la AEAT sin conexión de [Pruebas](/verifactu/es/guides/testing/), y `client` es
`aeat.client()`. Prueba también el caso contrario: un `fetch` que lance un error antes de llamar a
`aeat.fetch`, de modo que la AEAT nunca reciba el registro y la consulta no encuentre nada.
