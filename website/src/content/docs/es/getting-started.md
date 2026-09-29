---
title: Primeros pasos
description: Los siete pasos desde una factura emitida hasta una respuesta de la AEAT guardada, con un ejemplo de cada uno.
---

## Los pasos

**Describe tu software → Crea el registro → Compruébalo → Guárdalo → Imprime el código QR →
Envíalo → Guarda la respuesta**

## Lo que escribes tú

Cuatro piezas dependen de tu propia base de datos y de tu certificado, así que las escribes tú. Los
ejemplos de abajo las usan:

```ts
import type { RegistroAlta, RegistroAnterior, RespuestaSuministro } from "@waitron/verifactu";

// Carga el registro más reciente de tu base de datos, o devuelve null si todavía no hay ninguno.
declare function loadPreviousRecord(): Promise<RegistroAnterior | null>;

// Guarda un registro en tu base de datos.
declare function saveRecord(record: RegistroAlta): Promise<void>;

// Guarda la respuesta de la AEAT en tu base de datos.
declare function saveReply(reply: RespuestaSuministro): Promise<void>;

// Un fetch que presenta tu certificado de la AEAT. Hay un ejemplo en «Enviar a la AEAT».
declare const certificateFetch: typeof fetch;
```

## 1. Describe tu software

Esto lo rellenas una sola vez. Indica el nombre de tu software de facturación y de la empresa que lo
produce, e identifica tu SIF, el término de la AEAT para el sistema que emite tus facturas. Consulta
[Tu sistema de facturación (SIF)](/verifactu/es/guides/sif/) para saber cuándo necesitas más de uno.

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

## 2. Crea el registro

Cada registro se enlaza con el anterior, así que primero carga el registro anterior. Para el primer
registro de todos, `loadPreviousRecord` devuelve `null`.

Las fechas del registro se escriben en hora local, así que el constructor necesita la diferencia de
tu zona horaria con UTC en el momento de la emisión, en minutos. En España esa diferencia cambia en
verano, así que calcúlala para cada factura. Esto usa las reglas de zona horaria que trae
JavaScript:

```ts
function utcOffsetMinutes(date: Date, timeZone = "Europe/Madrid"): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!match) return 0; // "GMT" a secas significa que no hay diferencia
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

console.log(utcOffsetMinutes(new Date("2026-01-15T12:00:00Z"))); // 60
console.log(utcOffsetMinutes(new Date("2026-07-15T12:00:00Z"))); // 120
```

Usa `"Atlantic/Canary"` para Canarias.

```ts
import { buildAlta } from "@waitron/verifactu/facade";

const seller = { NombreRazon: "Example SL", NIF: "89890001K" };
const previous = await loadPreviousRecord(); // esto lo escribes tú
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

## 3. Compruébalo

Esto lanza un error si el registro tiene algún error, y el error los enumera todos. Usa
`validate(record)` en su lugar si también quieres ver las advertencias.

```ts
import { assertValid } from "@waitron/verifactu";

assertValid(record);
```

## 4. Guárdalo

Guarda el registro antes de enviarlo. Si el envío falla, puedes reintentar con exactamente el mismo
registro, y tu siguiente factura puede enlazarse con él.

```ts
await saveRecord(record); // esto lo escribes tú
```

## 5. Imprime el código QR

Esto te da la dirección web que va en el código QR. Dibújalo con cualquier biblioteca de QR e
imprímelo en la factura.

```ts
import { buildQrPayload } from "@waitron/verifactu";

const environment = "preproduction"; // el servicio de pruebas de la AEAT; usa "production" cuando pases a real
const qrUrl = buildQrPayload(record, environment);
```

## 6. Envíalo

`certificateFetch` es el fetch que has escrito para presentar tu certificado. La AEAT rechaza las
conexiones que no lo presentan.

```ts
import { createClient, SOAP_ENDPOINTS } from "@waitron/verifactu";

const client = createClient({ endpoint: SOAP_ENDPOINTS[environment], fetch: certificateFetch });
const reply = await client.submit({ ObligadoEmision: seller }, [{ RegistroAlta: record }]);
```

## 7. Guarda la respuesta

Guarda la respuesta completa en cuanto llegue. Su `CSV` es el justificante de la AEAT, y la AEAT no
te lo volverá a dar. La respuesta también te dice cuánto tienes que esperar antes de volver a
enviar.

```ts
import { resolveEstadoEfectivo } from "@waitron/verifactu";

await saveReply(reply); // esto lo escribes tú

for (const line of reply.RespuestaLinea) {
  console.log(line.IDFactura.NumSerieFactura, resolveEstadoEfectivo(line)); // T01/000123 accepted
}
console.log(reply.TiempoEsperaEnvio); // 60 (seconds to wait before the next send)
```

[La respuesta de la AEAT](/verifactu/es/guides/replies/) explica cada resultado y qué hacer en cada
caso.

## Pruébalo sin certificado

La copia sin conexión de la AEAT no necesita certificado ni red. Su reloj está fijado en el 21 de
julio de 2026 salvo que lo cambies, y así los resultados de las pruebas no cambian de un día para
otro.

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const testClient = createFakeAeat({ serverNow: new Date() }).client();
```

`testClient` funciona exactamente igual que el `client` de arriba. Consulta
[Pruebas](/verifactu/es/guides/testing/).
