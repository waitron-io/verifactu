---
title: Keep records and delivery together
description: Save each record before sending it, and recover when AEAT's answer is uncertain.
---

A network failure can leave you unsure whether AEAT received a record. If your application creates
a new invoice number or hash for the retry, it may send a different record for an invoice AEAT
already has. Keep the original record and a delivery job together so you can reconcile that
uncertainty.

This is an application design example, not a database or retry policy supplied by the library.
From a repository clone, run `npm ci && npm run build`, then
`node website/scripts/verify-delivery-example.mjs`. That worker uses an in-memory store and the
fake AEAT to exercise the paths below. Replace that store with durable transactions before using
the pattern for real invoices.

## Issue once, in one transaction

Serialize issuance for each seller and software installation. In one database transaction,
allocate the invoice number, read the preceding record, build the new record, and save both the
record and an outbox job. An **outbox** is a table of work waiting to be sent; saving it in the
same transaction prevents a committed invoice from losing its delivery job. Keep the completed
record immutable. The [record guide](/verifactu/en/guides/alta-record/) shows the builder inputs.

```ts
const record = store.transaction(({ records, outbox, number }) => {
  const previous = records.at(-1);
  const record = buildAltaRecord({
    ...sale,
    NumSerieFactura: `T01/${String(number).padStart(6, "0")}`,
    Encadenamiento: previous
      ? { RegistroAnterior: { ...previous.IDFactura, Huella: previous.Huella } }
      : { PrimerRegistro: "S" },
  });
  records.push(record);
  outbox.push({ record, state: "queued" });
  return record;
});
```

`store` is the example's in-memory store, not a package export. Its transaction keeps the read and
write together; your replacement must be durable and atomic, with an issuer lock across both. A
later delivery attempt reloads the saved record;
it does not call `buildAltaRecord` again. You can use `checkChain(savedRecords)` to inspect a
consistent stored snapshot, but a clean result does not prove that your store has no missing tail
or that AEAT accepted anything. See [chain checks](/verifactu/en/guides/huella-chain/).

## Send the saved record

The [submission guide](/verifactu/en/guides/submit/#supply-a-certificate-bearing-fetch) shows a
Node `undici` `Agent` that presents your client certificate and a `fetch` passed to
`createClient`. The worker uses that client, one job at a time for the issuer. Persist a `sending`
state before network I/O, then save the full response, its one-time `CSV`, each line's effective
outcome, and `TiempoEsperaEnvio` together as soon as the response arrives.

```ts
job.state = "sending";
try {
  const reply = await client.submit(header, [{ RegistroAlta: job.record }]);
  saveReply(store, job, reply, now);
} catch (error) {
  job.state = "unknown";
}
```

Treat `accepted_with_errors` as stored but flagged, `rejected` as not stored, and an unfamiliar or
missing line as unknown. Inspect the error code before deciding how to correct a rejected or
flagged record. AEAT's wait is in seconds; hold later submissions until it expires. If the wait
cannot be parsed, stop sending and investigate rather than treating it as zero. The complete
example asserts these branches with an offline fake store and transport.

## Reconcile an uncertain send

A thrown `VerifactuTransportError` gives you `kind`, possible HTTP `status`, SOAP `faultCode` and
`faultReason`, and a `cause` where available. It diagnoses a request failure; it does not say
whether AEAT stored the record. A response parser failure or a process crash after sending is
uncertain too. On restart, move interrupted `sending` jobs to `unknown` and pause later jobs for
that issuer until you resolve them. Do not log the whole error: server text and caller-supplied
causes can contain sensitive data.

For voluntary submissions, query the saved invoice identity with `consultar` and compare AEAT's
stored huella with your unchanged record. The example uses the invoice issue month for the query
because it has no `FechaOperacion`; use the operation month when your record has one. A matching
result confirms presence. An empty query does not prove the send failed. When a technical failure
leaves a submission without a response, [AEAT instructs you to resend the same records until you
obtain one](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/sistemas-verifactu.html).
Keep the outcome unknown while arranging that resend; use the saved record unchanged and interpret
duplicate detail with `resolveEstadoEfectivo`. The service for formal AEAT requirements has no
consulta endpoint, so its uncertain sends need a separate reconciliation procedure that can
resend the saved records. Investigate a reported SOAP or HTTP fault before resending. The library
does not schedule retries or choose their timing for you; honor any known AEAT wait.

The example uses a fake AEAT that first stores a record and then loses the response. Consulta
finds the same huella. It also tests a request lost before delivery: consulta finds nothing and the
job stays unknown. Neither case touches a real certificate or AEAT service.
