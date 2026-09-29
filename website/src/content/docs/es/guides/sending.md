---
title: Envío a la AEAT
description: Conéctate con tu certificado, elige la dirección correcta y envía registros por lotes.
---

## Tu certificado

La AEAT solo acepta conexiones que presenten un certificado emitido a tu nombre o al de tu empresa.
La biblioteca no lee certificados. En su lugar, le pasas un `fetch` que presenta el tuyo.

En Node, puedes hacerlo con `undici` y tu archivo de certificado (`.p12` o `.pfx`):

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

Carga el archivo y su contraseña desde donde guardes tus secretos y luego llama a
`createCertificateFetch(file, passphrase)`. Pruébalo con el servicio de pruebas de la AEAT antes de
usarlo en producción.

## Qué dirección

Elige la dirección según el tipo de certificado que tengas. Cada una tiene una dirección de
`production` y otra de `preproduction` (pruebas).

| Certificado                                | Direcciones            |
| ------------------------------------------ | ---------------------- |
| Un certificado personal o de representante | `SOAP_ENDPOINTS`       |
| Un certificado de sello de entidad         | `SOAP_ENDPOINTS_SELLO` |

## Envía un lote

La cabecera indica el emisor cuyas facturas envías. El emisor de cada registro debe coincidir con
él. Un lote admite hasta 1.000 registros, facturas y anulaciones mezcladas, en el orden en que los
creaste.

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

`submitRecords` de `@waitron/verifactu/facade` hace lo mismo en una sola llamada, y recibe los
registros tal cual, sin envolverlos en `RegistroAlta` y `RegistroAnulacion`.

## Cuándo enviar

En modalidad Veri\*Factu, envía cada registro cuando emitas la factura. Tras cada envío, la AEAT te
indica cuántos segundos esperar antes del siguiente (`TiempoEsperaEnvio`). Los registros que crees
mientras tanto esperan en tu cola. Solo puedes enviar antes si la cola llega a 1.000 registros.

## Enviar por cuenta de otra empresa

Si envías en nombre del emisor, añádete como `Representante` en la cabecera:

```ts
import type { Cabecera } from "@waitron/verifactu";

const header: Cabecera = {
  ObligadoEmision: seller,
  Representante: { NombreRazon: "Advisor SL", NIF: "B12345674" },
};
```

Este campo por sí solo no te da derecho a enviar. También necesitas la autorización del emisor, en
la forma que la AEAT acepta, y un certificado que la AEAT acepte para representarlo.

## Cuando la AEAT te pide registros

Si la AEAT te pide registros formalmente (un requerimiento), envíalos con
`RemisionRequerimiento: { RefRequerimiento }` en la cabecera, a las direcciones
`SOAP_ENDPOINTS_REQUERIMIENTO` o `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO`. Envía los registros
exactamente como los guardaste y pon `FinRequerimiento: "S"` en el último lote. Después no podrás
consultar estos registros.
