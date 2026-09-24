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

const thirdPartyIssued = buildAltaRecord({
  ...saleInput,
  EmitidaPorTerceroODestinatario: "T",
  Tercero: { NombreRazon: "Expedidor tercero SL", NIF: "B12345674" },
});
```

Aquí `saleInput` contiene los datos del ejemplo anterior y su enlace con la cadena. Incluye
`Destinatarios` en `F1`, `F3` y las facturas rectificativas `R1`–`R4`. Omítelo en las facturas
simplificadas `F2` y sus rectificaciones `R5`. `validate(fullInvoice)` devuelve un error que bloquea
el envío si incumples cualquiera de estas reglas. En las líneas de IVA, IPSI e IGIC, indica también
el código de régimen aplicable en `ClaveRegimen`. Omítelo para otros impuestos.

Una `F2` normalmente no puede superar 3010 € al sumar la base y la cuota repercutida de todas sus
líneas. Si la factura pertenece a un acuerdo de facturación registrado en la AEAT, indica su número
en `NumRegistroAcuerdoFacturacion`; el constructor y el ciclo XML conservan este campo, que no forma
parte de la huella. Solo la AEAT puede confirmar que el número está registrado.

En una rectificación, usa `FacturasRectificadas` solo con `R1`–`R5`. Usa
`FacturasSustituidas` solo con `F3`. `ImporteRectificacion` es obligatorio, y solo está permitido,
en una rectificación por sustitución (`TipoRectificativa: "S"`). Al corregir un registro después de
un rechazo de la AEAT, `RechazoPrevio: "S"` o `"X"` también exige `Subsanacion: "S"`. Una agrupación
de referencias presente debe contener al menos una factura. La validación local comprueba cada NIF
español referenciado, la longitud de 1–60 caracteres del número de factura y su fecha; solo la AEAT
puede confirmar que el NIF pertenece a un contribuyente censado.

Cuando el destinatario expida la factura, usa `EmitidaPorTerceroODestinatario: "D"` e inclúyelo en
`Destinatarios`. Como `F2` y `R5` prohíben `Destinatarios`, no pueden usar registros expedidos por
el destinatario (`"D"`). Cuando la expida otra persona o entidad, usa `"T"` e indica `Tercero` con
un `NIF` español o una identidad `IDOtro`, como en `thirdPartyIssued` arriba.

El NIF español del tercero debe ser distinto del NIF emisor de la factura. `buildAltaRecord`,
`serializeEnvio` y `parseEnvio` conservan estos campos en la posición oficial del XSD.
Cada destinatario también debe usar exactamente uno de `NIF` e `IDOtro`. Para `IDOtro`, la
validación local aplica las reglas publicadas por la AEAT sobre país español, tipo 07 y formato
NIF-IVA de la UE.

`buildAltaRecord` devuelve el registro completo, con fechas e importes formateados y su `Huella`.
El hash usa los mismos textos que se envían en el XML. Conserva el registro devuelto sin cambios,
guárdalo con la venta y [encadena el siguiente](/verifactu/es/guides/huella-chain/).
