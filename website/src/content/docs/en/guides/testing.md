---
title: Test without a network
description: Exercise submission, duplicates, and consulta with the fake AEAT transport.
---

Use the `./testing` entry point to test the whole client flow without a certificate or network:

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = aeat.client();
const response = await client.submit(cabecera, [{ RegistroAlta: record }]);

console.log(response.EstadoEnvio); // Correcto
console.log(response.CSV); // CSV-00000001
console.log(aeat.stored()[0].huella === record.Huella); // true
```

The fake accepts the same XML that `createClient` sends and returns parsed SOAP responses. It can
also force a rejection, omit duplicate detail, and return paged consulta results. Use it for
application tests; it does not replace AEAT preproduction checks with your real certificate.
