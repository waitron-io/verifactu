---
title: Primeros pasos
description: Instala la biblioteca y crea tu primer registro de factura.
---

Instala el paquete en un proyecto TypeScript:

```sh
npm install @waitron/verifactu
```

Asigna una identidad `SistemaInformatico` a tu instalación. Estos datos describen el programa,
no cada factura. En producción debes usar tus datos reales.

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

`offsetMinutes` es el desfase UTC del lugar de expedición **en el momento de emitir**. La España
peninsular usa 120 minutos en verano y 60 en invierno. Calcúlalo según el calendario del lugar; no
lo fijes como una constante. `buildAltaRecord` da formato a fechas e importes una sola vez y
calcula la huella a partir de esos mismos textos. No cambies el formato antes de enviar.

El primer registro usa `PrimerRegistro`. Para la siguiente factura copia la identidad y la
huella del registro anterior en `RegistroAnterior`. La [guía de la cadena](/verifactu/es/guides/huella-chain/)
muestra los cuatro campos. Después [envía el registro](/verifactu/es/guides/submit/).
