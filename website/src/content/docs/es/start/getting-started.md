---
title: Primeros pasos
description: Crea un registro, envíalo y consúltalo sin salir de tu equipo.
---

Instala el paquete en un proyecto TypeScript:

```sh
npm install @waitron/verifactu
```

El recorrido más corto empieza con una venta. Tu aplicación asigna el número de factura y
facilita la identidad del programa. El ejemplo fija una fecha de verano para que puedas comprobar
el resultado. En tu aplicación usa la fecha real y la identidad de tu sistema.

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
  DescripcionOperacion: "Café y almuerzo",
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
console.log(record.Huella); // 64 caracteres hexadecimales en mayúsculas
console.log(validate(record)); // [] en este ejemplo
```

El registro contiene la fecha y el total con el formato de envío y la huella calculada.
`validate` comprueba las reglas locales; detén el envío si hay un error. El primer registro usa
`PrimerRegistro`; los siguientes deben identificar el registro anterior que guardaste.
[Consulta sus cuatro campos](/verifactu/es/guides/huella-chain/).

## Envíalo a la AEAT falsa local

La AEAT falsa usa el mismo cliente XML y el mismo analizador de respuestas sin certificado ni
llamada de red. Continúa en el mismo archivo:

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

`CSV-00000001` es un justificante **falso** y previsible, no un CSV de la AEAT. En un sistema
desplegado guarda de forma duradera el registro terminado, el CSV real y cada línea de respuesta,
y respeta el tiempo de espera que indique la AEAT. Entrega `qrUrl` al
[generador de QR que elijas](/verifactu/es/guides/qr/). La biblioteca devuelve una URL, no una
imagen.

[Conecta tu almacenamiento, la conexión con certificado y preproducción real](/verifactu/es/guides/submit/).
El certificado autentica esa conexión; este ejemplo local no envía nada a la AEAT. La
[guía de la fachada](/verifactu/es/guides/facade/) muestra una llamada `buildAlta` más corta si
tu almacenamiento ya conoce el registro anterior. Tu sistema sigue a cargo de la numeración, la
cadena, los reintentos y el almacenamiento. [Lee los límites del SIF](/verifactu/es/start/not-a-sif/)
antes de desplegarlo.
