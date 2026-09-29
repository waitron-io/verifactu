---
title: Getting started
description: The seven steps from an issued invoice to a saved AEAT reply, with an example for each.
---

## The steps

**Describe your software → Build the record → Check it → Save it → Print the QR code → Send it →
Save the reply**

## What you write

Four pieces depend on your own database and certificate, so you write them yourself. The examples
below call them:

```ts
import type { RegistroAlta, RegistroAnterior, RespuestaSuministro } from "@waitron/verifactu";

// Load the most recent record from your database, or return null if there is none yet.
declare function loadPreviousRecord(): Promise<RegistroAnterior | null>;

// Save a record to your database.
declare function saveRecord(record: RegistroAlta): Promise<void>;

// Save AEAT's reply to your database.
declare function saveReply(reply: RespuestaSuministro): Promise<void>;

// A fetch that presents your AEAT certificate. See "Sending to AEAT" for an example.
declare const certificateFetch: typeof fetch;
```

## 1. Describe your software

You fill this in once. It names your invoicing software and the company that makes it, and
identifies your _SIF_, AEAT's term for the system that issues your invoices. See
[Your invoicing system (SIF)](/verifactu/en/simple/guides/sif/) for when you need more than one.

```ts
import type { SistemaInformatico } from "@waitron/verifactu";

const software: SistemaInformatico = {
  NombreRazon: "Example SL",
  NIF: "89890001K",
  NombreSistemaInformatico: "Example POS",
  IdSistemaInformatico: "01",
  Version: "1.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "N",
  IndicadorMultiplesOT: "N",
};
```

## 2. Build the record

Each record links to the one before it, so load the previous record first. For the very first
record, `loadPreviousRecord` returns `null`.

The record's dates are written in local time, so the builder needs your time zone's offset from
UTC at the moment of issue, in minutes. Spain's offset changes in summer, so work it out for each
invoice. This uses the time zone rules built into JavaScript:

```ts
function utcOffsetMinutes(date: Date, timeZone = "Europe/Madrid"): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!match) return 0; // "GMT" on its own means no offset
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

console.log(utcOffsetMinutes(new Date("2026-01-15T12:00:00Z"))); // 60
console.log(utcOffsetMinutes(new Date("2026-07-15T12:00:00Z"))); // 120
```

Use `"Atlantic/Canary"` for the Canary Islands.

```ts
import { buildAlta } from "@waitron/verifactu/facade";

const seller = { NombreRazon: "Example SL", NIF: "89890001K" };
const previous = await loadPreviousRecord(); // you write this
const issuedAt = new Date();

const record = buildAlta({
  IDEmisorFactura: seller.NIF,
  NombreRazonEmisor: seller.NombreRazon,
  NumSerieFactura: "T01/000123",
  FechaExpedicionFactura: issuedAt,
  TipoFactura: "F2",
  DescripcionOperacion: "Coffee and lunch",
  Desglose: [
    {
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "10.00",
      CuotaRepercutida: "2.10",
    },
  ],
  CuotaTotal: "2.10",
  ImporteTotal: "12.10",
  SistemaInformatico: software,
  generadoEn: issuedAt,
  offsetMinutes: utcOffsetMinutes(issuedAt),
  previous,
});
```

## 3. Check it

This throws if the record has any errors, and the error lists all of them. Use `validate(record)`
instead if you also want to see warnings.

```ts
import { assertValid } from "@waitron/verifactu";

assertValid(record);
```

## 4. Save it

Save the record before you send it. If sending fails, you can retry with exactly the same record,
and your next invoice can link to it.

```ts
await saveRecord(record); // you write this
```

## 5. Print the QR code

This gives you the web address that goes in the QR code. Draw it with any QR library and print it
on the invoice.

```ts
import { buildQrPayload } from "@waitron/verifactu";

const environment = "preproduction"; // AEAT's test service; use "production" when you go live
const qrUrl = buildQrPayload(record, environment);
```

## 6. Send it

`certificateFetch` is the fetch you wrote that presents your certificate. AEAT refuses connections
without one.

```ts
import { createClient, SOAP_ENDPOINTS } from "@waitron/verifactu";

const client = createClient({ endpoint: SOAP_ENDPOINTS[environment], fetch: certificateFetch });
const reply = await client.submit({ ObligadoEmision: seller }, [{ RegistroAlta: record }]);
```

## 7. Save the reply

Save the whole reply straight away. Its `CSV` is AEAT's receipt, and AEAT won't give it to you
again. The reply also tells you how long to wait before you send again.

```ts
import { resolveEstadoEfectivo } from "@waitron/verifactu";

await saveReply(reply); // you write this

for (const line of reply.RespuestaLinea) {
  console.log(line.IDFactura.NumSerieFactura, resolveEstadoEfectivo(line)); // T01/000123 accepted
}
console.log(reply.TiempoEsperaEnvio); // 60 (seconds to wait before the next send)
```

[AEAT's reply](/verifactu/en/simple/guides/replies/) explains every result and what to do about it.

## Try it without a certificate

The offline copy of AEAT needs no certificate or network. Its clock is fixed at 21 July 2026 unless
you set it, which keeps test results the same from day to day.

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const testClient = createFakeAeat({ serverNow: new Date() }).client();
```

`testClient` works exactly like `client` above. See [Testing](/verifactu/en/simple/guides/testing/).
