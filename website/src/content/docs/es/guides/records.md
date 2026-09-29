---
title: Registros de facturación
description: Crea registros para cualquier tipo de factura, facturas rectificativas y anulaciones.
---

Cada factura que emites necesita un registro, que la AEAT llama registro de alta. Anular una factura
necesita un registro de anulación. Esta página explica cómo crear los dos. Para saber qué significa
cada campo y qué valores se aplican a tus facturas, consulta la
[documentación de Veri\*Factu de la AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html).

## Dos formas de crear un registro

`buildAlta` recibe el registro anterior, o `null` para el primero. Es el que usa [Primeros pasos](/verifactu/es/getting-started/).

`buildAltaRecord` recibe el enlace con el registro anterior en el formato propio de la AEAT,
`Encadenamiento`. Úsalo cuando quieras construir ese enlace tú mismo:

```ts
import { buildAltaRecord } from "@waitron/verifactu";

const first = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000123",
  Encadenamiento: { PrimerRegistro: "S" },
});

const second = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: { RegistroAnterior: { ...first.IDFactura, Huella: first.Huella } },
});

console.log(first.IDFactura.FechaExpedicionFactura); // 20-07-2026
console.log(first.ImporteTotal); // 12.10
```

En estos ejemplos, `sale` contiene los campos de la factura de [Primeros pasos](/verifactu/es/getting-started/), con fecha del 20 de
julio de 2026.

Los dos constructores escriben las fechas como `DD-MM-YYYY` y los importes con dos decimales, y
calculan la huella del registro (`Huella`). Pasa los importes como cadenas de texto, por ejemplo
`"12.10"`, para no perder nada por el redondeo. No cambies un registro después de crearlo: la huella
cubre muchos de sus campos, y la AEAT la comprueba.

## Tipos de factura

| `TipoFactura` | Qué es                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| `F1`          | Una factura completa, con los datos del cliente                               |
| `F2`          | Una factura simplificada, como un tique de caja, sin cliente                  |
| `F3`          | Una factura completa que sustituye a una o más facturas simplificadas         |
| `R1` a `R4`   | Una rectificación de una factura completa. Cada número es un motivo distinto. |
| `R5`          | Una rectificación de una factura simplificada                                 |

Una factura simplificada tiene un límite de 3.000 € con impuestos incluidos, con algunas
excepciones.

## Datos del cliente

`F1`, `F3` y de `R1` a `R4` necesitan el cliente en `Destinatarios`. `F2` y `R5` no deben llevarlo.

```ts
import { assertValid } from "@waitron/verifactu";

const fullInvoice = buildAltaRecord({
  ...sale,
  NumSerieFactura: "A01/000001",
  TipoFactura: "F1",
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
  Encadenamiento: { RegistroAnterior: { ...second.IDFactura, Huella: second.Huella } },
});

assertValid(fullInvoice);
```

Un cliente sin NIF español usa `IDOtro` en lugar de `NIF`, con un código de país y un tipo de
identificación.

## Facturas rectificativas

Una factura rectificativa es una factura nueva de tipo `R1` a `R5`. Indica las facturas que
rectifica en `FacturasRectificadas`, y elige cómo las rectifica en `TipoRectificativa`:

- `"I"` recoge solo la diferencia, así que sus importes suelen ser negativos.
- `"S"` sustituye los importes originales, y además necesita los importes originales en
  `ImporteRectificacion`.

```ts
const correction = buildAltaRecord({
  ...sale,
  NumSerieFactura: "R01/000001",
  TipoFactura: "R1",
  TipoRectificativa: "I",
  FacturasRectificadas: [
    {
      IDEmisorFactura: sale.IDEmisorFactura,
      NumSerieFactura: "A01/000001",
      FechaExpedicionFactura: sale.FechaExpedicionFactura,
    },
  ],
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
  Desglose: [
    {
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "-2.00",
      CuotaRepercutida: "-0.42",
    },
  ],
  CuotaTotal: "-0.42",
  ImporteTotal: "-2.42",
  Encadenamiento: { RegistroAnterior: { ...fullInvoice.IDFactura, Huella: fullInvoice.Huella } },
});

assertValid(correction);
```

## Sustituir facturas simplificadas

Una `F3` sustituye facturas simplificadas por una factura completa, por ejemplo cuando un cliente
pide una factura a nombre de su empresa. Indica las facturas sustituidas en `FacturasSustituidas` e
incluye al cliente. Las facturas simplificadas no se anulan.

```ts
const replacement = buildAltaRecord({
  ...sale,
  NumSerieFactura: "A01/000002",
  TipoFactura: "F3",
  FacturasSustituidas: [
    {
      IDEmisorFactura: sale.IDEmisorFactura,
      NumSerieFactura: "T01/000123",
      FechaExpedicionFactura: sale.FechaExpedicionFactura,
    },
  ],
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Customer SL", NIF: "B12345674" }] },
  Encadenamiento: { RegistroAnterior: { ...correction.IDFactura, Huella: correction.Huella } },
});

assertValid(replacement);
```

## Corregir un registro que la AEAT rechazó o marcó

Crea un registro nuevo con el mismo número y la misma fecha de factura, con los datos corregidos y
`Subsanacion: "S"`:

- Si la AEAT guardó el registro original (lo aceptó con errores), no necesitas nada más.
- Si la AEAT rechazó el original y nunca lo guardó, pon también `RechazoPrevio: "X"`.

El registro corregido es un registro nuevo, así que se enlaza con el último registro de tu cadena, no
con el registro que corrige.

Si lo que estaba mal era la propia factura, y no solo su registro, necesitas una factura
rectificativa.

## Facturas emitidas por el cliente o por un tercero

Pon `EmitidaPorTerceroODestinatario` a `"D"` cuando el cliente haya emitido la factura por ti. El
cliente tiene que estar en `Destinatarios`, así que `F2` y `R5` no se pueden emitir de esta forma.

Ponlo a `"T"` cuando la haya emitido un tercero, e indica ese tercero en `Tercero`. Su NIF tiene que
ser distinto del tuyo.

## Anular una factura

Una anulación indica la factura que anula. También es un registro de tu cadena, así que se enlaza con
el último registro, sea cual sea.

```ts
import { buildAnulacionRecord } from "@waitron/verifactu";

const cancellation = buildAnulacionRecord({
  IDEmisorFacturaAnulada: sale.IDEmisorFactura,
  NumSerieFacturaAnulada: "T01/000124",
  FechaExpedicionFacturaAnulada: sale.FechaExpedicionFactura,
  Encadenamiento: { RegistroAnterior: { ...replacement.IDFactura, Huella: replacement.Huella } },
  SistemaInformatico: software,
  generadoEn: new Date("2026-07-20T12:05:00Z"),
  offsetMinutes: 120,
});

assertValid(cancellation);
```

Guarda juntas en tus registros la factura original y su anulación. El número de una factura anulada
no se puede volver a usar.

Si la AEAT nunca recibió un registro de la factura que anulas, pon `SinRegistroPrevio: "S"`.

## Tu propia referencia

`RefExterna` guarda con el registro una referencia tuya, como un número de pedido. Más adelante
puedes buscar por ella, y no afecta a la huella.

Para todos los demás campos, consulta la
[referencia de la API](/verifactu/api/index/interfaces/altainput/).
