---
title: Validar un registro
description: Detén los errores locales antes de enviar un registro a la AEAT.
---

Comprueba el registro completo antes de añadirlo a un lote:

```ts
import { assertValid } from "@waitron/verifactu";

assertValid(record);
```

`assertValid` lanza `VerifactuValidationError` cuando un `error` impide el envío. El mensaje nombra
cada campo incorrecto y la propiedad `issues` contiene los errores estructurados. Usa
`validate(record)` cuando necesites mostrar todos los problemas en un formulario. Un `warning`
requiere revisión, pero no hace que `assertValid` lance una excepción porque la AEAT puede aceptar
el registro. La validación comprueba formatos locales y algunas reglas de la AEAT. La respuesta de
la AEAT sigue siendo la fuente definitiva; examina cada línea después de enviar.

La comprobación de los totales admite una diferencia de 10 €. La AEAT excluye los regímenes `03`,
`05`, `06`, `08` y `09`. `validate` omite ambas comprobaciones si alguna línea usa uno de esos
regímenes. La exclusión se aplica al registro completo, por lo que una factura con regímenes mixtos
no produce un aviso por totales incoherentes. La preproducción de la AEAT confirmó este comportamiento
para un registro que combinaba los regímenes `01` y `03`.

`validate` también comprueba que el tipo de factura corresponda con la presencia de
`Destinatarios` y que las líneas de IVA, IPSI e IGIC incluyan `ClaveRegimen`, mientras que las de
otros impuestos lo omitan. No determina si el
código de régimen es el adecuado para tu operación; examina la respuesta de la AEAT para cada
registro enviado.

Los campos de rectificación se comprueban en conjunto. Los valores `S` y `X` de `RechazoPrevio`
exigen `Subsanacion: "S"`; `FacturasRectificadas` solo está permitido en `R1`–`R5`;
`FacturasSustituidas`, solo en `F3`; e `ImporteRectificacion` es obligatorio, y solo está permitido,
con `TipoRectificativa: "S"`. Los NIF de las facturas referenciadas reciben la misma comprobación
local de longitud y carácter de control que el NIF del emisor principal. La AEAT sigue siendo quien
confirma si un NIF está censado.

En un alta, `FechaExpedicionFactura` no puede ser anterior al 28 de octubre de 2024 ni posterior a
la fecha actual. Tampoco puede preceder a `FechaOperacion` en una línea de IVA o IGIC, salvo que
esa línea use el régimen `14` o `15`. La comprobación de la fecha actual usa el desfase numérico de
`FechaHoraHusoGenRegistro`, no la zona horaria del ordenador. En pruebas o aplicaciones con un
reloj controlado puedes pasar `{ now }` como segundo argumento de `validate` o `assertValid`.

Mantén `IDEmisorFactura` igual a `Cabecera.ObligadoEmision.NIF`. `serializeEnvio` rechaza el lote
si ambos valores difieren, antes de crear el XML. La AEAT permite un conjunto más amplio de
caracteres ASCII imprimibles en `NumSerieFactura`, pero esta biblioteca solo acepta letras,
dígitos, `/`, `_`, `.` y `-`. Este alfabeto más reducido evita ambigüedades cuando el número de
factura pasa a ser un parámetro de la consulta QR.

Para un identificador fiscal español de nueve caracteres, `NIF_CONTROL` señala un carácter de
control incorrecto o un formato desconocido. Comprueba el DNI, el NIE X/Y/Z, los NIF de entidades y
los NIF K/L/M con cuerpo numérico. La forma nueva de K/L/M puede tener letras en sus siete
caracteres centrales; la validación solo comprueba su forma. No confirma su letra de control.
`NIF_LENGTH` sigue señalando longitudes incorrectas. Una comprobación local
correcta no demuestra que el identificador pertenezca a un contribuyente real.
`NOMBRE_SISTEMA_LENGTH` señala un `SistemaInformatico.NombreSistemaInformatico` que supera el
máximo de 30 caracteres del esquema.
