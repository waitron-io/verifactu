---
title: Introducción
description: Qué hace la biblioteca y qué debe aportar tu sistema de facturación.
---

Al emitir una factura con Veri*Factu, su registro necesita una identidad estable, una huella
(un hash SHA-256) y un enlace con el registro anterior de la cadena. Después envías el registro a
la AEAT, conservas su respuesta y colocas en la factura un QR que permite comprobar sus datos.

`@waitron/verifactu` se encarga del protocolo: formato, construcción de registros, huellas,
validación, XML, contenido del QR y análisis de las respuestas SOAP. Tú aportas los datos de la
factura, el registro anterior, una conexión con certificado y almacenamiento duradero. La API no
guarda estado, para que puedas actualizar la cadena en la misma transacción que la venta.

Empieza con [tu primer registro](/verifactu/es/start/getting-started/) y luego
[envíalo a la AEAT](/verifactu/es/guides/submit/). La [referencia de la API](/verifactu/api/)
enumera los tipos y funciones públicos; sus identificadores y descripciones están en inglés.
