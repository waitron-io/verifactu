---
title: Crear un registro de alta
description: Convierte una venta en un RegistroAlta con formato y huella.
---

Un alta registra una factura emitida. Reúne la identidad de la factura, la descripción de la
operación, las líneas de impuestos, los totales, el enlace con la cadena y la identidad del SIF
antes de llamar a `buildAltaRecord`. El [ejemplo inicial](/verifactu/es/start/getting-started/)
crea una factura simplificada (`F2`).

En una factura completa (`F1`) debes identificar al destinatario:

```ts
const fullInvoice = buildAltaRecord({
  ...saleInput,
  TipoFactura: "F1",
  Destinatarios: {
    IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B12345678" }],
  },
});
```

Aquí `saleInput` contiene los datos del ejemplo anterior y su enlace con la cadena. Una factura
simplificada no puede llevar `Destinatarios`, mientras que una completa sí debe llevarlo.
`validate(fullInvoice)` devuelve un error que bloquea el envío si incumples cualquiera de estas
reglas.

`buildAltaRecord` devuelve el registro completo, con fechas e importes formateados y su `Huella`.
El hash usa los mismos textos que se envían en el XML. Conserva el registro devuelto sin cambios,
guárdalo con la venta y [encadena el siguiente](/verifactu/es/guides/huella-chain/).
