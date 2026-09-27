---
title: Getting started
description: Build an invoice record, then file and query it locally.
---

Install the package in a TypeScript project:

```sh
npm install @waitron/verifactu
```

The smallest useful path starts with a sale. Your application assigns its invoice number and
supplies the software identity. This example uses a fixed summer date so you can check the output;
use the actual issue time and your own identity in your application.

```ts
import { buildAltaRecord, validate, type SistemaInformatico } from "@waitron/verifactu";

const sistema: SistemaInformatico = {
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

const record = buildAltaRecord({
  IDEmisorFactura: sistema.NIF,
  NumSerieFactura: "T01/000123",
  FechaExpedicionFactura: new Date("2026-07-20T12:00:00Z"),
  NombreRazonEmisor: sistema.NombreRazon,
  TipoFactura: "F2",
  DescripcionOperacion: "Coffee and lunch",
  Desglose: [{ ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "21", BaseImponibleOimporteNoSujeto: "10.00", CuotaRepercutida: "2.10" }],
  CuotaTotal: "2.10",
  ImporteTotal: "12.10",
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: sistema,
  generadoEn: new Date("2026-07-20T12:00:00Z"),
  offsetMinutes: 120,
});

console.log(record.IDFactura.FechaExpedicionFactura); // 20-07-2026
console.log(record.ImporteTotal); // 12.10
console.log(record.Huella); // 64 uppercase hexadecimal characters
console.log(validate(record)); // [] for this example
```

The record contains the formatted invoice date, total and calculated huella. `validate` checks
local rules, so stop on any error before filing. The first record uses `PrimerRegistro`; later
records must name the preceding stored record. [See the four predecessor fields](/verifactu/en/guides/huella-chain/).

## File it against the local fake

The fake AEAT exercises the same XML client and response parser without a certificate or network
call. Continue in the same file:

```ts
import { buildQrPayload } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";

const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = fake.client();
const cabecera = { ObligadoEmision: { NombreRazon: sistema.NombreRazon, NIF: sistema.NIF } };
const response = await client.submit(cabecera, [{ RegistroAlta: record }]);
console.log(response.CSV); // CSV-00000001
console.log(response.RespuestaLinea[0]?.EstadoRegistro); // Correcto

const found = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: record.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
});
console.log(found.ResultadoConsulta); // ConDatos

const qrUrl = buildQrPayload(record, "preproduction");
console.log(new URL(qrUrl).searchParams.get("importe")); // 12.10
```

`CSV-00000001` is a deterministic **fake** receipt, not an AEAT receipt. In a deployment, save the
completed record and the real CSV and response lines durably; inspect each line and obey AEAT's
wait time. Pass `qrUrl` to the [QR renderer you choose](/verifactu/en/guides/qr/). The library
returns a URL, not an image.

[Connect your invoice store, certificate-bearing transport and real preproduction endpoint](/verifactu/en/guides/submit/).
A certificate authenticates that connection; this local example sends nothing to AEAT. The
[facade guide](/verifactu/en/guides/facade/) shows a shorter `buildAlta` call when your store already
has the preceding record. Your system remains responsible for numbering, chain order, retries
and storage; [read the SIF boundary](/verifactu/en/start/not-a-sif/) before deployment.
