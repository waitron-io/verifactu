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
    IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B12345674" }],
  },
});
```

Aquí `saleInput` contiene los datos del ejemplo anterior y su enlace con la cadena. Incluye
`Destinatarios` en `F1`, `F3` y las facturas rectificativas `R1`–`R4`. Omítelo en las facturas
simplificadas `F2` y sus rectificaciones `R5`. `validate(fullInvoice)` devuelve un error que bloquea
el envío si incumples cualquiera de estas reglas. En las líneas de IVA, IPSI e IGIC, indica también
el código de régimen aplicable en `ClaveRegimen`. Omítelo para otros impuestos.

En una rectificación, usa `FacturasRectificadas` solo con `R1`–`R5`. Usa
`FacturasSustituidas` solo con `F3`. `ImporteRectificacion` es obligatorio, y solo está permitido,
en una rectificación por sustitución (`TipoRectificativa: "S"`). Al corregir un registro después de
un rechazo de la AEAT, `RechazoPrevio: "S"` o `"X"` también exige `Subsanacion: "S"`. La validación
local comprueba el formato y el carácter de control de cada NIF español referenciado; solo la AEAT
puede confirmar que el NIF pertenece a un contribuyente censado.

`buildAltaRecord` devuelve el registro completo, con fechas e importes formateados y su `Huella`.
El hash usa los mismos textos que se envían en el XML. Conserva el registro devuelto sin cambios,
guárdalo con la venta y [encadena el siguiente](/verifactu/es/guides/huella-chain/).
