---
title: Reliable delivery
description: Never lose a record, or make a second one, between issuing an invoice and hearing from AEAT.
---

The risky moment is between issuing an invoice and getting AEAT's reply. A crash or a dropped
connection there must not lose the record, and a retry must not create a different one. The usual
way to do this is an _outbox_: a table of records waiting to be sent, kept in the same database as
the records themselves.

The library doesn't include a database or a queue, so the examples below use functions you write.

## Save the record and its job together

In one database transaction, reserve the next invoice number, load the latest record, build the new
one, save it, and add it to the outbox. If the transaction fails, neither the record nor the job
exists; if it succeeds, both do.

```ts
import { buildAlta } from "@waitron/verifactu/facade";
import type { RegistroAlta, RegistroAnterior } from "@waitron/verifactu";

interface Transaction {
  nextInvoiceNumber(): Promise<string>;
  latestRecord(): Promise<RegistroAnterior | null>;
  saveRecord(record: RegistroAlta): Promise<void>;
  addToOutbox(record: RegistroAlta): Promise<void>;
}

// Runs `work` in one database transaction, holding a lock for this seller. You write this.
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

Once saved, a record never changes. Every later attempt sends that saved record; nothing calls the
builder again.

## Send one job at a time

Give each job a state, and save the state before you send:

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

// Saves the job's new state in your database. You write this.
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

Around that:

- **After a crash, a job still marked `sending` becomes `unknown`.** The send may or may not have
  reached AEAT.
- **Send one job at a time for each seller and installation**, in the order you created them, and
  wait the time AEAT gives you (`TiempoEsperaEnvio`) between sends.
- **While a job is `unknown`, hold the later ones for that seller** until you know what happened
  to it.
- **Resolve an `unknown` job** as [AEAT's reply](/verifactu/en/simple/guides/replies/#after-a-failure)
  describes: send the same saved record again until you get a reply.

## Test a lost reply

The worst case is AEAT storing a record and the reply never arriving. You can reproduce it with the
offline AEAT by wrapping its `fetch`:

```ts
import { createClient, SOAP_ENDPOINTS } from "@waitron/verifactu";

const losesReply: typeof fetch = async (url, init) => {
  await aeat.fetch(url, init); // AEAT stores the record...
  throw new TypeError("connection reset"); // ...but the reply never arrives
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

Here `aeat` is the offline AEAT from [Testing](/verifactu/en/simple/guides/testing/), and `client`
is `aeat.client()`. Test the opposite case too: a `fetch` that throws before calling `aeat.fetch`,
so AEAT never receives the record and the lookup finds nothing.
