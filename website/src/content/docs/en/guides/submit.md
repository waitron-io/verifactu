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
  SOAP_ENDPOINTS_REQUERIMIENTO,
  SOAP_ENDPOINTS_REQUERIMIENTO_SELLO,
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

For an ordinary voluntary Veri*Factu submission, leave the header's remittance blocks absent.
You can add `RemisionVoluntaria: { FechaFinVeriFactu, Incidencia }` when those fields apply. If
you are submitting non-verifiable records because AEAT required them, use
`RemisionRequerimiento: { RefRequerimiento, FinRequerimiento }` instead; the reference is required.
The blocks cannot be combined. AEAT keeps under-requirement submissions in a separate service:
select `SOAP_ENDPOINTS_REQUERIMIENTO` or `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO` for its client, never
the voluntary `SOAP_ENDPOINTS` pair shown below. Consulta is only available for voluntary
Veri*Factu submissions. This library represents the request XML but does not determine your SIF's
operating mode or confirm that AEAT issued the reference.

The rest of this walkthrough builds new records for voluntary Veri*Factu. For a requirement,
submit the records already preserved by your SIF rather than rebuilding or changing their
business data to satisfy `assertValid`. AEAT treats business-rule errors in those preserved
records as admissible, except that NIF or `IDOtro` identity errors can still reject them. Read
each result, but do not correct business-rule errors in the preserved records. On your final
batch, set `FinRequerimiento: "S"` in `RemisionRequerimiento`, including when the requirement
takes only one batch. You cannot query these records through the voluntary consulta service.

The serializer checks the issuer's and representative's NIF form before sending. It also checks
the requirement reference's 18-character limit and a supplied `FechaFinVeriFactu`: its year must
be the current or preceding year, and from 1 January 2027 its date must be `31-12-20XX`. AEAT
uses its own clock and registration records, so its response remains authoritative. A batch may
contain 1–1000 separate wrappers, each holding one alta or one cancellation. The parser rejects
malformed wrappers too.

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

Warnings deserve review; errors block this voluntary submission. Do not use this `assertValid`
gate for records your SIF already preserved and AEAT requested. Local validation does not replace
AEAT's response, which is authoritative for each submitted record.

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
sets provide production and preproduction URLs; voluntary submission and consulta use the same
selected URL. For under-requirement submission, choose the matching `*_REQUERIMIENTO` set instead.
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

if (response.TiempoEsperaEnvio === undefined) {
  throw new Error(`AEAT wait is unusable: ${JSON.stringify(response.TiempoEsperaEnvioRaw)}`);
}
await scheduleNextSubmissionAfter(response.TiempoEsperaEnvio * 1000);
```

`storeCsvDurably`, `storeLineResult`, and `scheduleNextSubmissionAfter` stand for your own database
and queue operations. Persist `CSV` **as soon as it arrives**, before further processing. It is
absent when AEAT rejects a submission outright, and consulta cannot retrieve it later.

When AEAT includes `DatosPresentacion`, the parser returns its presenter NIF and timestamp. It also
checks that every returned invoice identity has the XSD's NIF length, 1–60-character serial number,
and `DD-MM-YYYY` date shape, and that error codes are integers that JavaScript can represent exactly.
If one of those structural checks fails, `client.submit` throws and cannot return the CSV or the
other lines. If you need the non-conforming XML for reconciliation, retain a clone of the raw HTTP
response in your certificate-bearing `fetch` wrapper before the client parses it.

Read every line through `resolveEstadoEfectivo`. Its result is `accepted`,
`accepted_with_errors`, `rejected`, `status_unknown`, `duplicate_annulled`, or `duplicate_unknown`.
If a line has a missing or unfamiliar `EstadoRegistro`, `status_unknown` keeps you from treating
it as rejected. Persist the CSV, inspect the raw status, and reconcile the record with AEAT before
deciding what to send next. The parser also preserves a missing or unfamiliar global `EstadoEnvio`
instead of discarding the CSV. Do not infer a batch outcome from that value.

AEAT error 3000 (duplicate) can say `EstadoRegistro: "Incorrecto"` while the already stored
record is actually accepted. The resolved state reads the duplicate detail.
`duplicate_annulled` needs investigation;
`duplicate_unknown` means AEAT did not say what it holds, so query and compare huellas before you
decide what to do. `TiempoEsperaEnvio` is AEAT's wait in **seconds** before the next submission;
the example above waits for that full interval. For voluntary Veri*Factu, AEAT also allows the
next submission when your queue reaches the maximum 1,000 records before the interval ends.
Schedule whichever happens first. A smaller pending batch must wait for the interval.

An absent or unusable wait no longer hides the response's one-time CSV or line results. Save those
first, then stop your submission queue and inspect `TiempoEsperaEnvioRaw`. Do not treat an unknown
wait as zero seconds or guess when another send is allowed.

If you need to distinguish an alta from a cancellation, read `line.Operacion?.TipoOperacion`.
`Operacion` is a structured object, not the string `"Alta"` or `"Anulacion"`. The parser
preserves an unfamiliar operation code instead of discarding the accepted lines and CSV in the
same batch.

For voluntary Veri*Factu, a rejected record or one accepted with an admissible error may require
a new corrected record. First check whether a rectificativa or cancellation is required instead.
AEAT exempts some admissible errors, including a future generation timestamp, from correction.
Under an AEAT requirement, do not apply that voluntary repair flow to business-rule errors in
the preserved records.

Use the category in AEAT's current
[error-code list](https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/errores.properties),
not the number's shape, to interpret an error. The list separates whole-request rejection,
record rejection, and errors that still accept the record. Its accepted category currently
contains `2000`–`2009`; the validation publication specifically exempts `2004` (a future
`FechaHoraHusoGenRegistro`) and `2009` (a missing IPSI regime during its transition) from the
need to correct. The parser preserves codes and descriptions but deliberately does not choose a
repair workflow for you. A future invoice issue date is different: code `1112` rejects the
record.

## Handle faults and uncertain results

If `client.submit` throws, you have no parsed per-record result or CSV to store. Keep the original
records and inspect the error. A SOAP `Server` fault, a stalled transmission, or a response that
is not the expected XML calls for resending the same message. A SOAP `Client` fault means the
message is malformed or contains incorrect information: use its `faultstring` to fix the problem
before you resend it. The client reports faults but does not retry automatically.

After an uncertain result, a repeated record may receive error 3000 because AEAT already stored
it. Do not assign it a new invoice number or hash just to make the retry pass. Interpret the
duplicate detail and, when it does not settle the outcome, use voluntary consulta to compare
AEAT's stored hash with yours. The under-requirement service has no consulta.

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

Keep `IDEmisorFacturaAnulada` equal to `cabecera.ObligadoEmision.NIF`; the serializer rejects a
different issuer. When you set `GeneradoPor`, also supply `Generador` with its name and either a
NIF or `IDOtro`. The reverse is required too. The generator's NIF must differ from the taxpayer's.
`GeneradoPor: "E"` requires a NIF. For a Spanish `IDOtro`, `D` accepts ID types `03` and `07`,
while `T` accepts only `03` and forbids `07` regardless of country. The builder preserves these
fields without adding them to the cancellation hash. AEAT remains responsible for checking whether
an identity is registered.

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
