---
title: Sending to AEAT
description: Connect with your certificate, pick the right address, and send records in batches.
---

## Your certificate

AEAT only accepts connections that present a certificate issued to you or your company. The library
doesn't read certificates. Instead, you pass it a `fetch` that presents yours.

In Node, you can do this with `undici` and your certificate file (`.p12` or `.pfx`):

```sh
npm install undici
```

```ts
import { Agent } from "undici";

function createCertificateFetch(pfx: Buffer, passphrase: string): typeof fetch {
  const dispatcher = new Agent({ connect: { pfx, passphrase } });
  return (url, init) => fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent });
}
```

Load the file and its passphrase from wherever you keep secrets, then call
`createCertificateFetch(file, passphrase)`. Try it against AEAT's test service before you use it
in production.

## Which address

Pick the address by the kind of certificate you have. Each has a `production` and a
`preproduction` (test) address.

| Certificate                                     | Addresses              |
| ----------------------------------------------- | ---------------------- |
| A personal or representative certificate        | `SOAP_ENDPOINTS`       |
| A company seal certificate (_sello de entidad_) | `SOAP_ENDPOINTS_SELLO` |

## Send a batch

The header names the seller whose invoices you are sending. Every record's issuer must match it.
A batch holds up to 1,000 records, invoices and cancellations mixed, in the order you created them.

```ts
import {
  buildAnulacionRecord,
  createClient,
  MAX_REGISTROS_POR_ENVIO,
  SOAP_ENDPOINTS,
  type EnvioRegistro,
} from "@waitron/verifactu";

const cancellation = buildAnulacionRecord({
  IDEmisorFacturaAnulada: record.IDFactura.IDEmisorFactura,
  NumSerieFacturaAnulada: record.IDFactura.NumSerieFactura,
  FechaExpedicionFacturaAnulada: sale.FechaExpedicionFactura,
  Encadenamiento: { RegistroAnterior: { ...record.IDFactura, Huella: record.Huella } },
  SistemaInformatico: software,
  generadoEn: new Date("2026-07-20T12:05:00Z"),
  offsetMinutes: 120,
});

const batch: EnvioRegistro[] = [{ RegistroAlta: record }, { RegistroAnulacion: cancellation }];
console.log(batch.length <= MAX_REGISTROS_POR_ENVIO); // true

const client = createClient({ endpoint: SOAP_ENDPOINTS.preproduction, fetch: certificateFetch });
const reply = await client.submit({ ObligadoEmision: seller }, batch);

console.log(reply.RespuestaLinea.length); // 2
```

`submitRecords` from `@waitron/verifactu/facade` does the same in one call, taking plain records
rather than the `RegistroAlta` and `RegistroAnulacion` wrappers.

## When to send

In Veri\*Factu mode, send each record when you issue the invoice. After each send, AEAT tells you
how many seconds to wait before the next one (`TiempoEsperaEnvio`). Records you create in the
meantime wait in your queue. You can send early only if the queue reaches 1,000 records.

## Sending for another business

If you send on behalf of the seller, add yourself as `Representante` in the header:

```ts
import type { Cabecera } from "@waitron/verifactu";

const header: Cabecera = {
  ObligadoEmision: seller,
  Representante: { NombreRazon: "Advisor SL", NIF: "B12345674" },
};
```

This field alone doesn't give you the right to send. You also need the seller's authorisation, in
the form AEAT accepts, and a certificate AEAT accepts for representing them.

## When AEAT asks for records

If AEAT formally asks you for records (a _requerimiento_), send them with
`RemisionRequerimiento: { RefRequerimiento }` in the header, to the `SOAP_ENDPOINTS_REQUERIMIENTO`
or `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO` addresses. Send the records exactly as you stored them, and
set `FinRequerimiento: "S"` on the last batch. You can't look up these records afterwards.
