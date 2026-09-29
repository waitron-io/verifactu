---
title: Encadenar registros
description: Cómo la huella enlaza cada registro con el anterior, qué cuenta como una cadena y qué tiene que hacer tu base de datos.
---

## La huella y la cadena

Cada registro lleva una huella. Es un hash SHA-256 de algunos campos del registro. En una factura,
esos campos son el NIF del emisor, el número de factura, la fecha de expedición, el tipo de factura,
la cuota total, el importe total, la hora en que se generó el registro y la **huella del registro
anterior**.

Ese último campo es lo que forma la cadena. La huella de cada registro depende de la del anterior,
que depende de la del anterior a ese, y así hasta el primer registro. Si se cambia, se quita o se
desordena un registro, los enlaces dejan de coincidir, y la AEAT lo ve.

La biblioteca calcula la huella al crear el registro. Tu parte es guardar cada registro y darle al
siguiente un enlace hacia él.

## Apunta al registro anterior

Un registro nuevo identifica al anterior con cuatro de sus campos: el NIF del emisor, el número de
factura, la fecha de expedición y la huella. Toma los cuatro del registro guardado:

```ts
import { buildAltaRecord, type RegistroAlta, type RegistroAnterior } from "@waitron/verifactu";

function linkTo(previous: RegistroAlta): RegistroAnterior {
  return { ...previous.IDFactura, Huella: previous.Huella };
}

const next = buildAltaRecord({
  ...sale,
  NumSerieFactura: "T01/000124",
  Encadenamiento: { RegistroAnterior: linkTo(record) },
});

console.log(next.Encadenamiento.RegistroAnterior?.NumSerieFactura); // T01/000123
```

El primer registro de una cadena no tiene a qué apuntar, así que usa
`Encadenamiento: { PrimerRegistro: "S" }` en su lugar.

## Qué cuenta como una cadena

Hay una cadena por cada emisor en cada sistema de facturación. La AEAT llama SIF a un sistema de
facturación: el hardware y el software con los que emites facturas. Cada instalación de tu software
es un SIF distinto; [Tu sistema de facturación (SIF)](/verifactu/es/guides/sif/) tiene los detalles.

- **Las series de facturas comparten la cadena.** Tus tiques de caja `T01` y tus facturas completas
  `A01` van en la misma cadena, una detrás de otra en el orden en que las creas.
- **Un año nuevo no la reinicia.** El primer registro del año nuevo se enlaza con el último registro
  del año anterior.
- **Las anulaciones y las facturas rectificativas también van en ella**, en el orden en que las
  creas. Si anulas o rectificas una factura que se emitió en otro sistema, el registro nuevo va en la
  cadena del sistema que usas ahora.
- **Cada instalación tiene su propia cadena.** Las cajas o tiendas que emiten facturas por su cuenta,
  sin conexión en tiempo real con un sistema central, son sistemas distintos. Cada una necesita su
  propio número de instalación (`NumeroInstalacion`) y tiene su propia cadena. Las cajas conectadas
  en tiempo real a un mismo sistema central pueden compartir la cadena de ese sistema.
- **Una reinstalación es un sistema nuevo.** Incluso el mismo software reinstalado en el mismo
  ordenador necesita un número de instalación nuevo, y su cadena vuelve a empezar con
  `PrimerRegistro: "S"`.

Solo el primer registro de cada cadena usa `PrimerRegistro`. Si envías un segundo primer registro con
los mismos datos de software (`SistemaInformatico`), la AEAT lo guarda pero lo marca con el código de
advertencia 2007.

## Series de facturas

Una serie es una secuencia de numeración, como `T01` para los tiques de caja. Las series y las
cadenas son cosas distintas: uses las series que uses, cada SIF mantiene una cadena por emisor, y
todas las series van a parar a ella.

El reglamento de facturación ([RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696),
artículos 6 y 7) dice que los números de una serie son correlativos, y exige series separadas para:

- las rectificaciones de facturas completas
- las facturas que emiten por ti el cliente o un tercero, con una serie para cada uno
- las facturas simplificadas y las completas, cuando emites las dos en el mismo año natural

Esto es un resumen, no asesoramiento legal; consulta el reglamento o a un asesor fiscal para tu caso.

Nada en las normas de la AEAT ata una serie a un SIF, así que no tienes que empezar una serie nueva
cuando cambias de sistema. Lo que no puedes hacer es emitir dos veces el mismo número de factura: la
AEAT identifica una factura por el emisor, el número de factura y la fecha de expedición, no por el
sistema que la emitió. Si dos SIF emiten facturas a la vez, como dos cajas independientes, da a cada
uno su propia serie.

## El trabajo de tu base de datos

La biblioteca no guarda estado, así que la cadena vive en tu base de datos. Para cada factura nueva:

1. En una sola transacción, reserva el siguiente número de factura y carga el último registro.
2. Crea el registro nuevo, enlazado con ese.
3. Guárdalo antes de enviarlo, y luego libera el bloqueo.

Si se crean dos facturas a la vez sin ese bloqueo, las dos se enlazan con el mismo registro anterior
y la cadena se rompe. La biblioteca no guarda la cadena en memoria porque un fallo o un reinicio la
perdería.

## Comprueba una cadena guardada

`checkChain` comprueba los registros que le pasas, en el orden en que los creaste. Para cada registro
vuelve a calcular la huella, compara los cuatro campos del enlace con el registro anterior y comprueba
que las horas de generación no van hacia atrás:

```ts
import { checkChain } from "@waitron/verifactu";

const result = checkChain([record, next]);
console.log(result.scope, result.issues.length); // complete 0
```

Cada problema de `issues` tiene la posición del registro (`recordIndex`), un `code` como
`PREDECESSOR_HUELLA_MISMATCH` y el `field` que ha fallado. `scope` indica lo que le has dado:

- `"complete"`: los registros empiezan por el primer registro de la cadena.
- `"partial"`: empiezan a mitad de la cadena. Pasa el registro justo anterior como `predecessor`
  para que también se pueda comprobar el primer enlace.
- `"empty"`: no había nada que comprobar.

```ts
console.log(checkChain([next]).issues[0]?.code); // PREDECESSOR_MISSING
console.log(checkChain([next], { predecessor: record }).issues.length); // 0
```

Solo comprueba los registros que le pasas. Elegir qué registros pertenecen a una cadena (un emisor en
un SIF), asegurarte de que no falta ninguno al final y comprobar los campos que no entran en la
huella es cosa tuya. `verifyHuella(record)` comprueba por separado la huella de un solo registro.
