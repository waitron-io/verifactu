---
title: Submit and query AEAT
description: From a sale to a stored AEAT response, including certificates and duplicate handling.
---

The tricky part of a Veri*Factu integration is what happens **after** a record is built. You need
to send it with a client certificate, keep AEAT's one-time receipt, interpret each result, and wait
before the next submission. This walkthrough follows two sales from record construction through
response handling. It also shows consulta and cancellation.

## Prepare the taxpayer and system identities

`SistemaInformatico` identifies your software installation. `Cabecera.ObligadoEmision` identifies
the taxpayer whose records you submit. Fill these with the real values for your deployment:

```ts
import {
  assertValid,
  buildAltaRecord,
  buildAnulacionRecord,
  createClient,
  resolveEstadoEfectivo,
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_SELLO,
  validate,
  type Cabecera,
  type SistemaInformatico,
} from "@waitron/verifactu";

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

const cabecera: Cabecera = {
  ObligadoEmision: { NombreRazon: "Example SL", NIF: "89890001K" },
};
```

Add `Representante: { NombreRazon, NIF }` to `cabecera` only when a representative submits for the
taxpayer. One `Cabecera` may cover records from several SIF installations of the same taxpayer in
one submission, since each record includes its own `SistemaInformatico`. Every alta must repeat
`cabecera.ObligadoEmision.NIF` in `IDEmisorFactura`; the serializer stops before sending if they
differ.

## Build and chain two records

Your application assigns invoice numbers and stores the preceding record. The first record of a
chain says `PrimerRegistro: "S"`. Every later record points at the immediately preceding record's
identity and huella:

```ts
const issuedAt = new Date("2026-07-20T12:00:00Z");
const sale = {
  IDEmisorFactura: cabecera.ObligadoEmision.NIF,
  FechaExpedicionFactura: issuedAt,
  NombreRazonEmisor: cabecera.ObligadoEmision.NombreRazon,
  TipoFactura: "F2" as const,
  DescripcionOperacion: "Coffee and lunch",
  Desglose: [{
    ClaveRegimen: "01",
    CalificacionOperacion: "S1",
    TipoImpositivo: "21",
    BaseImponibleOimporteNoSujeto: "10.00",
    CuotaRepercutida: "2.10",
  }],
  CuotaTotal: "2.10",
  ImporteTotal: "12.10",
  SistemaInformatico: sistema,
  generadoEn: issuedAt,
  offsetMinutes: 120,
};

const first = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000123",
  Encadenamiento: { PrimerRegistro: "S" },
});

const second = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: {
    RegistroAnterior: {
      IDEmisorFactura: first.IDFactura.IDEmisorFactura,
      NumSerieFactura: first.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: first.IDFactura.FechaExpedicionFactura,
      Huella: first.Huella,
    },
  },
});
```

The four `RegistroAnterior` fields come from the stored first record, including its **formatted**
date. `buildAltaRecord` formats values exactly once and calculates the new `Huella` for you. Do
not hash the input separately or alter the returned record before serializing it. In a real
application, use each sale's actual issue and generation times and derive `offsetMinutes` from
its issuing location's time zone on that date.

## Stop on blocking validation issues

```ts
for (const record of [first, second]) {
  for (const issue of validate(record).filter(({ severity }) => severity === "warning")) {
    console.warn(issue.field, issue.message);
  }
  assertValid(record);
}
```

Warnings deserve review; errors block submission. Local validation does not replace AEAT's
response, which is authoritative for each submitted record.

## Supply a certificate-bearing fetch

AEAT authenticates the connection with a client certificate (mTLS). The package does not read
certificates. In Node, install `undici` and create a dispatcher from your PKCS#12/PFX bundle and
its passphrase:

```sh
npm install undici
```

```ts
import { readFile } from "node:fs/promises";
import { Agent } from "undici";

const pfx = await readFile("/secure/path/to/client.p12");
const dispatcher = new Agent({ connect: { pfx, passphrase: process.env.AEAT_PFX_PASSPHRASE } });
const certificateFetch: typeof globalThis.fetch = (url, init) =>
  fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent });

const certificateKind = process.env.AEAT_CERTIFICATE_KIND; // "representative" or "sello"
const environment = process.env.AEAT_ENVIRONMENT === "production" ? "production" : "preproduction";
const endpoints = certificateKind === "sello" ? SOAP_ENDPOINTS_SELLO : SOAP_ENDPOINTS;
const client = createClient({ endpoint: endpoints[environment], fetch: certificateFetch });
```

`SOAP_ENDPOINTS_SELLO` uses AEAT's separate host for a _sello de entidad_ certificate. Both endpoint
sets provide production and preproduction URLs; submission and consulta use the same selected URL.
Keep the certificate and passphrase in your deployment's secret storage. Close the dispatcher when
your process shuts down. The dispatcher wrapper above is exercised against the package's fake
transport in this site's example check; a real certificate must also be checked in AEAT
preproduction before you rely on it in production.

## Submit and retain the response

```ts
import { MAX_REGISTROS_POR_ENVIO } from "@waitron/verifactu";

const records = [{ RegistroAlta: first }, { RegistroAlta: second }];
if (records.length > MAX_REGISTROS_POR_ENVIO) throw new Error("Batch too large");

const response = await client.submit(cabecera, records);

if (response.CSV !== undefined) {
  await storeCsvDurably(response.CSV);
}

for (const line of response.RespuestaLinea) {
  const effectiveState = resolveEstadoEfectivo(line);
  await storeLineResult(line.IDFactura, effectiveState, line.CodigoErrorRegistro);
}

await scheduleNextSubmissionAfter(response.TiempoEsperaEnvio * 1000);
```

`storeCsvDurably`, `storeLineResult`, and `scheduleNextSubmissionAfter` stand for your own database
and queue operations. Persist `CSV` **as soon as it arrives**, before further processing. It is
absent when AEAT rejects a submission outright, and consulta cannot retrieve it later.

Read every line through `resolveEstadoEfectivo`. Its result is `accepted`,
`accepted_with_errors`, `rejected`, `duplicate_annulled`, or `duplicate_unknown`. AEAT error 3000
(duplicate) can say `EstadoRegistro: "Incorrecto"` while the already stored record is actually
accepted. The resolved state reads the duplicate detail. `duplicate_annulled` needs investigation;
`duplicate_unknown` means AEAT did not say what it holds, so query and compare huellas before you
decide what to do. `TiempoEsperaEnvio` is AEAT's wait in **seconds** before the next submission;
schedule it rather than sending the next batch immediately.

## Query a record after an uncertain result

`PeriodoImputacion` is required even for one invoice. The client takes its `Ejercicio` and
`Periodo` as a flat `ConsultaFiltro`:

```ts
const result = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: first.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: first.IDFactura.FechaExpedicionFactura,
});

const stored = result.registros.find(
  (item) => item.IDFactura.NumSerieFactura === first.IDFactura.NumSerieFactura,
);
if (stored) {
  console.log(stored.EstadoRegistro, stored.DatosRegistroFacturacion.Huella);
  console.log(stored.DatosRegistroFacturacion.Huella === first.Huella);
}
```

Compare AEAT's stored huella with your persisted record when resolving `duplicate_unknown`.
`NumSerieFactura` and `FechaExpedicionFactura` are optional narrowing filters. A period sweep may
return several pages: if `IndicadorPaginacion` is `"S"`, pass the response's `ClavePaginacion`
unchanged in the next filter. See [Query AEAT](/verifactu/en/guides/consulta/).

## Cancel a record

An anulación names the invoice being cancelled. It is itself a new chain record, so it points at
the most recent record in the chain at the time you build it:

```ts
const cancellation = buildAnulacionRecord({
  IDEmisorFacturaAnulada: first.IDFactura.IDEmisorFactura,
  NumSerieFacturaAnulada: first.IDFactura.NumSerieFactura,
  FechaExpedicionFacturaAnulada: issuedAt,
  Encadenamiento: {
    RegistroAnterior: { ...second.IDFactura, Huella: second.Huella },
  },
  SistemaInformatico: sistema,
  generadoEn: new Date("2026-07-20T12:05:00Z"),
  offsetMinutes: 120,
});

assertValid(cancellation);
const cancellationResponse = await client.submit(cabecera, [
  { RegistroAnulacion: cancellation },
]);
```

Handle this response, its CSV, and its wait time the same way as an alta. Schedule the cancellation
submission after the wait returned by the previous submission.

## Run the flow offline first

Replace the certificate transport with the package's fake AEAT when testing:

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const testClient = createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fake.fetch });
const testResponse = await testClient.submit(cabecera, [{ RegistroAlta: first }]);
console.log(testResponse.CSV); // CSV-00000001
console.log(resolveEstadoEfectivo(testResponse.RespuestaLinea[0])); // accepted
```

The same client, serializer, and response parser run against the fake. Use it to exercise retries,
duplicates, consulta, and cancellation before connecting to preproduction.
