---
title: Enviar y consultar a la AEAT
description: De una venta a una respuesta guardada, con certificado y tratamiento de duplicados.
---

La parte más delicada de una integración Veri*Factu viene **después** de construir el registro.
Debes enviarlo con un certificado de cliente, conservar el justificante que solo llega una vez,
interpretar cada resultado y esperar antes del siguiente envío. Esta guía sigue dos ventas desde
la construcción de sus registros hasta la respuesta. También cubre consulta y anulación.

## Prepara las identidades del obligado y del sistema

`SistemaInformatico` identifica tu instalación. `Cabecera.ObligadoEmision` identifica al
contribuyente cuyos registros envías. Sustituye estos datos por los reales de tu despliegue:

```ts
import {
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

Añade `Representante: { NombreRazon, NIF }` a `cabecera` solo si un representante presenta los
registros. Una `Cabecera` puede incluir registros de varios SIF del mismo contribuyente en un
envío, porque cada registro lleva su propio `SistemaInformatico`.

## Construye y encadena dos registros

Tu aplicación asigna los números de factura y guarda el registro precedente. El primero de una
cadena lleva `PrimerRegistro: "S"`. Cada registro posterior apunta a la identidad y huella del
inmediatamente anterior:

```ts
const issuedAt = new Date("2026-07-20T12:00:00Z");
const sale = {
  IDEmisorFactura: cabecera.ObligadoEmision.NIF,
  FechaExpedicionFactura: issuedAt,
  NombreRazonEmisor: cabecera.ObligadoEmision.NombreRazon,
  TipoFactura: "F2" as const,
  DescripcionOperacion: "Café y almuerzo",
  Desglose: [{
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

Los cuatro campos de `RegistroAnterior` proceden del primer registro guardado, incluida su fecha
**ya formateada**. `buildAltaRecord` da formato una sola vez y calcula la nueva `Huella`; no
calcules otra huella a partir de la entrada ni modifiques el registro antes de serializarlo. En
tu aplicación usa las fechas reales de cada venta y calcula `offsetMinutes` según la zona horaria
del lugar de expedición en esa fecha.

## Detén los errores de validación bloqueantes

```ts
for (const record of [first, second]) {
  const issues = validate(record);
  for (const issue of issues) {
    console.log(issue.severity, issue.code, issue.field, issue.message);
  }
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error(`No envíes ${record.IDFactura.NumSerieFactura}`);
  }
}
```

Revisa los avisos; los errores impiden el envío. La validación local no sustituye a la respuesta
de la AEAT, que determina el resultado de cada registro enviado.

## Proporciona un fetch con certificado

La AEAT autentica la conexión con un certificado de cliente (mTLS). El paquete no lee
certificados. En Node instala `undici` y crea un `dispatcher` con tu fichero PKCS#12/PFX y su
contraseña:

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

const certificateKind = process.env.AEAT_CERTIFICATE_KIND; // "representative" o "sello"
const environment = process.env.AEAT_ENVIRONMENT === "production" ? "production" : "preproduction";
const endpoints = certificateKind === "sello" ? SOAP_ENDPOINTS_SELLO : SOAP_ENDPOINTS;
const client = createClient({ endpoint: endpoints[environment], fetch: certificateFetch });
```

`SOAP_ENDPOINTS_SELLO` usa el servidor específico para un certificado de _sello de entidad_. Ambos
conjuntos tienen URL de producción y preproducción; envío y consulta usan la misma URL elegida.
Guarda certificado y contraseña en el almacén de secretos de tu despliegue y cierra el
`dispatcher` cuando termine el proceso. El ejemplo comprobable de este sitio ejercita la
adaptación de `fetch` contra la AEAT falsa; comprueba también tu certificado real en
preproducción antes de usarlo en producción.

## Envía y conserva la respuesta

```ts
import { MAX_REGISTROS_POR_ENVIO } from "@waitron/verifactu";

const records = [{ RegistroAlta: first }, { RegistroAlta: second }];
if (records.length > MAX_REGISTROS_POR_ENVIO) throw new Error("Lote demasiado grande");

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

`storeCsvDurably`, `storeLineResult` y `scheduleNextSubmissionAfter` representan tu base de datos
y tu cola de tareas. Conserva el `CSV` **en cuanto llegue**, antes de seguir procesando: falta
cuando la AEAT rechaza el envío entero y una consulta posterior no puede recuperarlo.

Interpreta cada línea con `resolveEstadoEfectivo`. Devuelve `accepted`, `accepted_with_errors`,
`rejected`, `duplicate_annulled` o `duplicate_unknown`. En el error 3000 (duplicado),
`EstadoRegistro` puede decir `Incorrecto` aunque el registro ya guardado esté aceptado. La
función consulta el detalle del duplicado. `duplicate_annulled` exige investigar;
`duplicate_unknown` indica que la AEAT no aclaró lo que guarda: consulta y compara las huellas
antes de decidir. `TiempoEsperaEnvio` son los **segundos** que exige esperar antes del siguiente
envío; programa el próximo lote en consecuencia.

## Consulta cuando el resultado es incierto

`PeriodoImputacion` es obligatorio incluso para una sola factura. `ConsultaFiltro` expresa sus
campos `Ejercicio` y `Periodo` directamente:

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

Para resolver `duplicate_unknown`, compara la huella almacenada por la AEAT con la de tu
registro persistido. `NumSerieFactura` y `FechaExpedicionFactura` son filtros opcionales. Si
`IndicadorPaginacion` vale `"S"`, pasa la `ClavePaginacion` recibida, sin modificar, en la
siguiente consulta. Más detalles en [Consultar a la AEAT](/verifactu/es/guides/consulta/).

## Anula un registro

Una anulación identifica la factura que cancelas. También es un registro nuevo de la cadena,
por lo que apunta al último registro existente cuando la construyes:

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

if (validate(cancellation).some((issue) => issue.severity === "error")) {
  throw new Error("No envíes una anulación inválida");
}
const cancellationResponse = await client.submit(cabecera, [
  { RegistroAnulacion: cancellation },
]);
```

Conserva el CSV, interpreta cada línea y respeta el tiempo de espera igual que en un alta.
Programa este envío de anulación para después de la espera indicada por el envío anterior.

## Prueba todo sin conexión

En las pruebas sustituye la conexión con certificado por la AEAT falsa del paquete:

```ts
import { createFakeAeat } from "@waitron/verifactu/testing";

const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const testClient = createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fake.fetch });
const testResponse = await testClient.submit(cabecera, [{ RegistroAlta: first }]);
console.log(testResponse.CSV); // CSV-00000001
console.log(resolveEstadoEfectivo(testResponse.RespuestaLinea[0])); // accepted
```

El cliente, serializador y analizador de respuestas son los mismos. Prueba reintentos,
duplicados, consultas y anulaciones así antes de conectar con preproducción.
