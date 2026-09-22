---
title: Getting started
description: Install the library and build your first invoice record.
---

Install the package in a TypeScript project:

```sh
npm install @waitron/verifactu
```

Give your deployed invoicing system a `SistemaInformatico` identity. These values describe the
software installation, not an individual invoice. Use your real registered details in production.

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

`offsetMinutes` is the issuing location's UTC offset **at issue time**. Spain's mainland uses 120
minutes in summer and 60 in winter; derive it from the issuing location's calendar rather than
hard-coding it. `buildAltaRecord` formats amounts and dates once and hashes those same strings.
Do not reformat a record before sending it.

The first record uses `PrimerRegistro`. For the next invoice, copy the preceding record's
identity and huella into `RegistroAnterior`; [the chain guide](/verifactu/en/guides/huella-chain/)
shows the exact shape. Then [submit the record](/verifactu/en/guides/submit/).
