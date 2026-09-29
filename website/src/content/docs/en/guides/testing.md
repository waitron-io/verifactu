---
title: Testing
description: Test your whole flow against an offline copy of AEAT.
---

`@waitron/verifactu/testing` includes an offline copy of the AEAT service. It reads the same XML
the real service does and replies the way AEAT does, so your tests run the library's real client
without a certificate or a network.

## Send to the offline AEAT

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = aeat.client();

const reply = await client.submit(cabecera, [{ RegistroAlta: record }]);
console.log(reply.CSV); // CSV-00000001
console.log(aeat.stored().length); // 1
```

Its clock is fixed at 21 July 2026 unless you pass `serverNow`, which keeps your tests the same
from day to day. Like AEAT, it rejects an invoice dated after its clock. Move the clock during a
test with `aeat.setServerNow(date)`.

If your code creates its own client, pass it `aeat.fetch` in place of your certificate fetch:

```ts
import { createClient } from "@waitron/verifactu";

const yourClient = createClient({ endpoint: "https://aeat.test/", fetch: aeat.fetch });
```

## Make AEAT misbehave

Use these to test how your code handles each kind of result. Each takes the invoice's key from
`keyOf(record)`.

| Call                                    | What happens                                                 |
| --------------------------------------- | ------------------------------------------------------------ |
| `aeat.reject(key, code, message)`       | Every send of that invoice is rejected with your error code. |
| `aeat.dropRegistroDuplicadoDetail(key)` | A resend is reported as a duplicate with no details.         |
| `aeat.annul(key)`                       | The stored invoice is marked as cancelled.                   |
| `aeat.forget(key)`                      | AEAT loses the invoice, so a lookup finds nothing.           |

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

## What it doesn't prove

The offline AEAT follows many of AEAT's published rules and what we have seen the real service do.
It is still a copy. Before you go live, test with your real certificate against AEAT's test service
(preproduction).

It also doesn't:

- check that each record links to the actual previous record
- keep records sent because AEAT asked for them (a _requerimiento_) separate from ordinary ones
