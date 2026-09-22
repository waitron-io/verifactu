---
title: Build and submit with fewer steps
description: Use the stateless facade while keeping invoice numbers and the hash chain in your database.
---

Your application must choose the next invoice number and remember the preceding record. Once you
have those values, the facade builds the alta and submits plain records without making you assemble
the XML wrappers. It keeps no chain state of its own.

Use `sale`, `cabecera`, and the certificate bearing `certificateFetch` from the
[submission guide](/verifactu/en/guides/submit/). The first record has no predecessor. For the
second, pass all four values from the first record that you saved:

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
    throw new Error(`Invalid invoice ${record.IDFactura.NumSerieFactura}`);
  }
}

const response = await submitRecords(
  { endpoint: SOAP_ENDPOINTS.preproduction, fetch: certificateFetch },
  cabecera,
  [first, second],
);
console.log(response.EstadoEnvio); // Correcto
```

`buildAlta` uses the same formatting and hash calculation as `buildAltaRecord`. Save the assigned
number, the completed record, and the AEAT response durably. Inspect each response line and obey
the wait time before another submission, as the [submission guide](/verifactu/en/guides/submit/)
shows. `submitRecords` sends the records in the order you supply; it does not validate, renumber, or
retry them.
