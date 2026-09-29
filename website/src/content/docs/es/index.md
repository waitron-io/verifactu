---
title: "@waitron/verifactu"
description: Crea, comprueba y envía registros de facturación Veri*Factu desde tu sistema de facturación en TypeScript.
---

`@waitron/verifactu` es una biblioteca de TypeScript para las normas Veri\*Factu de España. Por cada
factura que emites, crea el registro que necesita la Agencia Tributaria (AEAT), lo comprueba, lo
envía y lee la respuesta de la AEAT.

:::caution[No es asesoramiento legal ni fiscal]
Esta documentación explica cómo usar la biblioteca. Resume algunas normas de la AEAT, pero no es
asesoramiento legal ni fiscal. Lee la [documentación de Veri\*Factu de la AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html) para conocer las normas, y
consulta tu caso con un asesor fiscal.
:::

## Qué la hace diferente

Hace el trabajo de Veri\*Factu y deja todas las demás decisiones en tus manos. Tú eliges la base de
datos, cómo cargas el certificado, cómo dibujas el código QR y cómo presentas y entregas tus
facturas. No guarda nada entre llamadas, así que tú decides cómo se almacenan los registros y en qué
orden se envían.

Tiene una sola dependencia, `fast-xml-parser`, y nada de código nativo.

## Qué hace

- Crea registros de facturas y anulaciones, incluidas las facturas rectificativas y las facturas que
  sustituyen a facturas simplificadas.
- Acepta todos los códigos de impuesto y de régimen especial del formato de registro de la AEAT, no
  solo el IVA general: el IGIC de Canarias, el IPSI de Ceuta y Melilla, y regímenes como los de
  bienes usados, agencias de viajes, criterio de caja, recargo de equivalencia y agricultura,
  ganadería y pesca, además de las ventas exentas, la inversión del sujeto pasivo y los clientes del
  extranjero. Y los comprueba con muchas de las normas que publica la AEAT. Consulta
  [Impuestos y regímenes especiales](/verifactu/es/guides/tax/).
- Calcula la huella (hash) que enlaza cada registro con el anterior, y comprueba un registro suelto
  o una cadena de registros que le pases.
- Comprueba cada registro antes de que lo envíes e informa de cada problema como error o
  advertencia, con un código y el campo al que afecta.
- Convierte los registros en el XML que espera la AEAT y vuelve a leer ese XML, tanto en las
  peticiones como en las respuestas.
- Envía registros a la AEAT y consulta los que ya has enviado.
- Deduce el resultado real de cada factura a partir de la respuesta de la AEAT, incluidos los
  reenvíos que la AEAT marca como duplicados, y te da el tiempo que la AEAT pide esperar antes de
  volver a enviar.
- Crea la dirección web que va en el código QR de la factura.
- Incluye una copia sin conexión del servicio de la AEAT para tus pruebas.

## Qué hace tu aplicación

- Guarda los registros y las respuestas de la AEAT.
- Numera las facturas y enlaza cada registro nuevo con el anterior dentro de una única transacción
  de base de datos.
- Carga tu certificado y hace la llamada HTTPS, pasando una función `fetch`.
- Dibuja el código QR y maqueta la factura.
- Reintenta tras un fallo y consulta a la AEAT cuando un resultado no está claro.
- Decide qué registros pertenecen a cada cadena y se los pasa en orden a la comprobación de la
  cadena.

[Lo que hace tu aplicación](/verifactu/es/guides/your-application/) lo explica con más detalle.

## Qué no hace

No admite la modalidad sin envío, que la AEAT llama _NO VERI\*FACTU_. En esa modalidad tu sistema guarda los
registros, firma cada uno electrónicamente, lleva un registro de eventos y solo envía registros a la
AEAT cuando esta se los pide. La biblioteca solo admite la modalidad _VERI\*FACTU_, en la que cada
registro va a la AEAT en cuanto emites la factura.

## Instalación

```sh
npm install @waitron/verifactu
```

Después sigue [Primeros pasos](/verifactu/es/getting-started/) para crear y enviar tu primer
registro.
