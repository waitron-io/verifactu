---
title: Lo que hace tu aplicación
description: Las partes de un sistema de facturación que cumple las reglas y que la biblioteca deja en tus manos.
---

Las reglas de la AEAT se aplican a todo tu sistema de facturación, que la AEAT llama SIF (sistema
informático de facturación). La biblioteca es una parte de él. Tu sistema en conjunto tiene que
cumplir las reglas, y su productor firma una declaración de que lo hace (una declaración
responsable).

## Registros y respuestas

- Numera las facturas y no reutilices nunca un número, ni siquiera el de una factura anulada o de
  prueba.
- Encadena cada registro nuevo con el anterior, en una sola transacción de base de datos. Consulta
  [Encadenar registros](/verifactu/es/guides/chain/).
- Guarda cada registro antes de enviarlo, y guarda la respuesta y el justificante de la AEAT en
  cuanto lleguen.
- Envía cada registro cuando emitas la factura, no en un lote al final del día.
- Tras un fallo, reintenta con el mismo registro, y consulta los registros cuando un resultado no
  esté claro. Consulta [La respuesta de la AEAT](/verifactu/es/guides/replies/).

## La identidad de tu software

Consulta [Tu sistema de facturación (SIF)](/verifactu/es/guides/sif/) para saber cuándo necesitas
más de una instalación.

- Da a cada instalación su propio `NumeroInstalacion`, y no lo reutilices nunca para el mismo
  emisor, ni siquiera después de reinstalar.
- Si tienes un servicio para muchas empresas, pon `IndicadorMultiplesOT` a `"S"` para un usuario que
  tiene más de una empresa configurada, incluidas las inactivas. Básalo en ese usuario, no en
  cuántos clientes tiene tu servicio.

## Facturas

- No crees registros para borradores ni presupuestos. Un borrador pasa a ser una factura, con un
  registro y un código QR, solo cuando lo emites.
- No borres una factura emitida. Anúlala con un registro de anulación.
- Diseña la factura, incluido el código QR. Consulta [Códigos QR](/verifactu/es/guides/qr/).
- Conserva las propias facturas, como exigen tus normas contables.

## Otras responsabilidades

- Si envías en nombre de otras empresas, ten su autorización.
- Permite que un inspector de Hacienda acceda a los datos fiscales que necesita, sin exponer nada
  más.

## Lo que la biblioteca no hace

- Decidir si las reglas de la AEAT se aplican a una empresa, o qué códigos de impuesto encajan con
  una venta.
- Admitir la modalidad sin envío (NO VERI\*FACTU), en la que tu sistema guarda y firma los registros
  él mismo en lugar de enviar cada uno a la AEAT. No firma registros ni lleva un registro de
  eventos.

Lee la [procedencia y el aviso legal](https://github.com/waitron-io/verifactu/blob/main/PROVENANCE.md)
del proyecto antes de tomar cualquier ejemplo de aquí como un diseño completo.
