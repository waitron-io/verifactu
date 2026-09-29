---
title: Impuestos y regímenes especiales
description: Líneas de impuesto para cualquier impuesto, régimen especial, exención e inversión del sujeto pasivo.
---

:::caution[No es asesoramiento legal ni fiscal]
Esta página resume las reglas de la AEAT para ayudarte a usar la biblioteca. Lee
[la documentación de Veri\*Factu de la AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html) para conocer las reglas, y consulta tu caso con un
asesor fiscal.
:::

Cada registro desglosa su impuesto en una o más líneas en `Desglose`. La biblioteca acepta todos
los códigos de impuesto y de régimen especial del formato de registro de la AEAT, no solo el IVA
general, y comprueba cada línea con las reglas que la AEAT publica para ella. Pasar esas
comprobaciones no garantiza que la AEAT acepte el registro.

## Qué impuesto

`Impuesto` indica el impuesto. Déjalo fuera para el IVA español.

| `Impuesto` | Impuesto                             |
| ---------- | ------------------------------------ |
| `"01"`     | IVA. Es el valor por defecto.        |
| `"02"`     | IPSI, el impuesto de Ceuta y Melilla |
| `"03"`     | IGIC, el impuesto de Canarias        |
| `"05"`     | Cualquier otro impuesto              |

## Qué régimen

`ClaveRegimen` indica el régimen. Las líneas de IVA, IPSI e IGIC lo necesitan; las de otros
impuestos deben dejarlo fuera. Los códigos del IVA son:

| Código | Régimen                                                                                 |
| ------ | --------------------------------------------------------------------------------------- |
| `"01"` | Régimen general                                                                         |
| `"02"` | Exportación                                                                             |
| `"03"` | Régimen especial de bienes usados, objetos de arte, antigüedades y objetos de colección |
| `"04"` | Régimen especial del oro de inversión                                                   |
| `"05"` | Régimen especial de las agencias de viajes                                              |
| `"06"` | Régimen especial del grupo de entidades en IVA (nivel avanzado)                         |
| `"07"` | Régimen especial del criterio de caja                                                   |
| `"08"` | Operaciones sujetas al IPSI o al IGIC                                                   |
| `"09"` | Agencias de viajes que actúan como mediadoras                                           |
| `"10"` | Cobros por cuenta de terceros, como los de un colegio profesional                       |
| `"11"` | Arrendamiento de local de negocio                                                       |
| `"14"` | IVA pendiente de devengo en certificaciones de obra para una Administración Pública     |
| `"15"` | IVA pendiente de devengo en operaciones de tracto sucesivo, como suscripciones          |
| `"17"` | Regímenes de ventanilla única de la UE (OSS e IOSS)                                     |
| `"18"` | Recargo de equivalencia                                                                 |
| `"19"` | Régimen especial de la agricultura, ganadería y pesca (REAGYP)                          |
| `"20"` | Régimen simplificado                                                                    |

El IGIC usa los mismos códigos hasta el `"15"`, y después `"17"` para el comerciante minorista,
`"18"` para el pequeño empresario o profesional, `"19"` para operaciones interiores exentas, `"20"`
para operaciones sujetas al IPSI y `"21"` para el régimen simplificado. El IPSI admite `"01"`,
`"08"`, `"11"`, `"18"`, `"19"` y `"20"`.

## Sujeta, exenta o no sujeta

Cada línea está sujeta, con `CalificacionOperacion`, o exenta, con `OperacionExenta`:

| Campo                   | Valor           | Significado                                                               |
| ----------------------- | --------------- | ------------------------------------------------------------------------- |
| `CalificacionOperacion` | `"S1"`          | Sujeta, y tú repercutes el impuesto                                       |
|                         | `"S2"`          | Sujeta, pero el cliente declara el impuesto (inversión del sujeto pasivo) |
|                         | `"N1"`          | No sujeta según las reglas generales del impuesto                         |
|                         | `"N2"`          | No sujeta en España por el lugar donde se hace la venta                   |
| `OperacionExenta`       | `"E1"` a `"E6"` | Exenta, citando el artículo de la ley del impuesto que se aplica          |

El IGIC tiene también `"E7"` y `"E8"`. Una línea sujeta `S1` necesita el tipo (`TipoImpositivo`)
y la cuota repercutida (`CuotaRepercutida`). Las demás los dejan fuera, salvo `S2`, que pone ambos a
cero.

## Una exportación a un cliente de fuera de la UE

Una exportación usa el régimen `"02"` y está exenta. Un cliente sin NIF español usa `IDOtro`, con
su país y el tipo de identificación (`"04"` es un documento oficial de su país):

```ts
import { assertValid, buildAltaRecord } from "@waitron/verifactu";

const exportInvoice = buildAltaRecord({
  ...sale,
  NumSerieFactura: "E01/000001",
  TipoFactura: "F1",
  DescripcionOperacion: "Olive oil",
  Destinatarios: {
    IDDestinatario: [
      { NombreRazon: "Customer Inc", IDOtro: { CodigoPais: "US", IDType: "04", ID: "12-3456789" } },
    ],
  },
  Desglose: [
    { ClaveRegimen: "02", OperacionExenta: "E2", BaseImponibleOimporteNoSujeto: "500.00" },
  ],
  CuotaTotal: "0.00",
  ImporteTotal: "500.00",
  Encadenamiento: { PrimerRegistro: "S" },
});

assertValid(exportInvoice);
```

## El recargo de equivalencia

Cuando vendes a un minorista en recargo de equivalencia, usa el régimen `"18"` y añade a la línea el
tipo y la cuota del recargo:

```ts
const surchargeInvoice = buildAltaRecord({
  ...sale,
  NumSerieFactura: "A01/000010",
  TipoFactura: "F1",
  Destinatarios: { IDDestinatario: [{ NombreRazon: "Corner Shop SL", NIF: "B12345674" }] },
  Desglose: [
    {
      ClaveRegimen: "18",
      CalificacionOperacion: "S1",
      TipoImpositivo: "21",
      BaseImponibleOimporteNoSujeto: "100.00",
      CuotaRepercutida: "21.00",
      TipoRecargoEquivalencia: "5.2",
      CuotaRecargoEquivalencia: "5.20",
    },
  ],
  CuotaTotal: "26.20",
  ImporteTotal: "126.20",
  Encadenamiento: {
    RegistroAnterior: { ...exportInvoice.IDFactura, Huella: exportInvoice.Huella },
  },
});

assertValid(surchargeInvoice);
```

## Varias líneas

Una factura con más de un tipo o régimen tiene una línea para cada uno. `CuotaTotal` es la suma del
impuesto (y del recargo, si lo hay) de todas las líneas, e `ImporteTotal` es el total de bases e
impuesto. La AEAT admite una diferencia de hasta 10 €, trata una mayor como un aviso y no como un
rechazo, y no hace esta comprobación en algunos regímenes.

## Qué comprueba

En cada línea, `validate` comprueba que los códigos están permitidos para ese impuesto y tipo de
factura, que el tipo de IVA es uno que la AEAT acepta en esa fecha, que la cuota cuadra con la base y
el tipo, y que se cumplen las reglas propias de cada régimen. Por ejemplo, el régimen `"14"` necesita
una fecha de operación posterior a la de expedición y un cliente que sea una Administración Pública.
No puede comprobar que el régimen que eliges encaja con la venta.
