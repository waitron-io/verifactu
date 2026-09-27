---
title: Elige por dónde empezar
description: Cómo encaja esta biblioteca de protocolo en tu aplicación de facturación.
---

Ya tienes una aplicación de facturación y quieres añadir Veri*Factu sin ceder el control de la
base de datos ni del flujo de facturas. Esta biblioteca recibe los datos y el registro anterior
que le entregas, crea un **alta** (registro de una factura nueva), calcula su **huella** (hash
SHA-256), lo valida, prepara el XML y la URL del QR de cotejo, e interpreta las respuestas de la
AEAT, la Agencia Tributaria. Tu **SIF** (sistema informático de facturación) desplegado decide
cuándo expedir, cómo guardar y qué hacer tras cada respuesta.

Elige esta biblioteca si quieres incorporar funciones de protocolo TypeScript a una aplicación
existente y controlar el almacenamiento, la numeración, los reintentos, la conexión con certificado
y la imagen QR. Como la API no guarda estado, puedes conservar el registro terminado junto a la
factura en tu propia transacción. Debes diseñar esa transacción y la concurrencia de la cadena.

Si necesitas una biblioteca que gestione una serie, firme registros para la modalidad NO Veri*Factu
o genere imágenes QR, compara las [funciones de serie y firma XAdES de `@inoguerols/verifactu`](https://github.com/inoguerols/verifactu#readme).
Si buscas un cliente que configure el certificado y ofrezca imágenes QR y una interfaz de comandos,
compara [`verifactu-sdk`](https://github.com/eloi24/verifactu-sdk/blob/main/README.md), cuyo README
actual lo califica de alfa. Comprueba la API y la adecuación de cada proyecto antes de elegir.
Este paquete no firma registros ni determina si tu sistema cumple la normativa.

Empieza con [un registro y una respuesta local](/verifactu/es/start/getting-started/).
La [guía de envío](/verifactu/es/guides/submit/) incorpora después tu base de datos, la conexión
con certificado, el tratamiento de respuestas y la consulta. Lee [qué debe aportar el SIF](/verifactu/es/start/not-a-sif/)
antes de tomar el ejemplo como diseño de despliegue.
