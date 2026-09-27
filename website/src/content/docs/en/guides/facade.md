---
title: Connect your invoice store
description: Keep numbering and chain state in your database while the facade builds records.
---

Your application must reserve the next invoice number and find the preceding record before it
builds a new one. Do those operations under the concurrency controls of your database. The facade
accepts the predecessor or `null` for the first record, then builds the alta without keeping its
own chain state.

This example uses `sale`, `cabecera`, and `certificateFetch` from the
[submission walkthrough](/verifactu/en/guides/submit/). Implement `InvoiceStore` with your own
durable store. Reserve the number and read the predecessor together so two workers do not take
the same chain position. Keep that chain position reserved until `saveRecord` commits; if your
store cannot do that across these calls, combine them in one database transaction.

```ts
import { buildAlta } from "@waitron/verifactu/facade";
import {
  buildQrPayload,
  createClient,
  resolveEstadoEfectivo,
  SOAP_ENDPOINTS,
  validate,
  type Cabecera,
  type RegistroAlta,
  type RegistroAnterior,
  type RespuestaSuministro,
  type SistemaInformatico,
} from "@waitron/verifactu";
import type { BuildAltaInput } from "@waitron/verifactu/facade";

type InvoiceStore = {
  reserveAndLoad(): Promise<{ serial: string; previous: RegistroAnterior | null }>;
  saveRecord(record: RegistroAlta): Promise<void>;
  saveResponse(response: RespuestaSuministro): Promise<void>;
  scheduleNext(ms: number): Promise<void>;
};

async function fileSale(
  store: InvoiceStore,
  sale: Omit<BuildAltaInput, "NumSerieFactura" | "previous">,
  cabecera: Cabecera,
  certificateFetch: typeof fetch,
) {
  const { serial, previous } = await store.reserveAndLoad();
  const record = buildAlta({ ...sale, NumSerieFactura: serial, previous });
  const errors = validate(record).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`Invalid invoice ${serial}: ${errors[0].message}`);
  await store.saveRecord(record);

  const client = createClient({ endpoint: SOAP_ENDPOINTS.preproduction, fetch: certificateFetch });
  const response = await client.submit(cabecera, [{ RegistroAlta: record }]);
  await store.saveResponse(response); // Include the one-time CSV and every response line.
  for (const line of response.RespuestaLinea) {
    console.log(line.IDFactura.NumSerieFactura, resolveEstadoEfectivo(line));
  }
  if (response.TiempoEsperaEnvio === undefined) throw new Error("Check AEAT's raw wait value");
  await store.scheduleNext(response.TiempoEsperaEnvio * 1000);

  const found = await client.consultar(cabecera, {
    Ejercicio: "2026",
    Periodo: "07",
    NumSerieFactura: record.IDFactura.NumSerieFactura,
    FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
  });
  const qrUrl = buildQrPayload(record, "preproduction");
  return { record, response, found, qrUrl };
}
```

For this July 2026 sale, your store could reserve `T01/000123` with `previous: null`. The local
fake used in the [first example](/verifactu/en/start/getting-started/) then returns
`CSV-00000001`, an accepted line, and a `ConDatos` consultation containing the same huella.
Real AEAT statuses, CSV and wait time are determined by its response. Use the record's imputation
year and month for `Ejercicio` and `Periodo`; the literals above belong to this example.

Save the completed record before submission so a retry uses the same identity and huella. Persist
the response and CSV as soon as they arrive, then schedule the next submission after AEAT's wait.
`fileSale` shows the sequence, not a complete queue. Your queue must handle interruptions,
uncertain results and retries.
Pass `qrUrl` to the [renderer you choose](/verifactu/en/guides/qr/). The package supplies the URL,
not an image. The [submission guide](/verifactu/en/guides/submit/) shows a certificate-bearing
`fetch`, response edge cases and the voluntary-consulta boundary. `buildAlta` does not validate,
store, retry or send by itself.
