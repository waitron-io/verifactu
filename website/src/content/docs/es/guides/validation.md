---
title: Validar un registro
description: Detén los errores locales antes de enviar un registro a la AEAT.
---

Comprueba el registro completo antes de añadirlo a un lote:

```ts
import { validate } from "@waitron/verifactu";

const issues = validate(record);
for (const issue of issues) {
  console.log(issue.severity, issue.code, issue.field, issue.message);
}
if (issues.some((issue) => issue.severity === "error")) {
  throw new Error("No envíes un registro con errores bloqueantes");
}
```

Un `error` impide el envío. Un `warning` requiere revisión, pero puede describir un registro que
la AEAT aceptaría, como un total que supera la tolerancia de una comprobación cruzada. La
validación comprueba formatos locales y algunas reglas de la AEAT. La respuesta de la AEAT sigue
siendo la fuente definitiva; examina cada línea después de enviar.

La comprobación de los totales admite una diferencia de 10 €. La AEAT no la aplica cuando una
línea de impuestos lleva `ClaveRegimen` `03`, `05`, `06`, `08` o `09`, por lo que `validate` también
la omite.

`validate` también comprueba que el tipo de factura corresponda con la presencia de
`Destinatarios` y que las líneas de IVA, IPSI e IGIC incluyan `ClaveRegimen`, mientras que las de
otros impuestos lo omitan. No determina si el
código de régimen es el adecuado para tu operación; examina la respuesta de la AEAT para cada
registro enviado.

Para un identificador fiscal español de nueve caracteres, `NIF_CONTROL` señala un carácter de
control incorrecto o un formato desconocido. Comprueba el DNI, el NIE X/Y/Z, los NIF de entidades y
los NIF K/L/M con cuerpo numérico. La forma nueva de K/L/M puede tener letras en sus siete
caracteres centrales; la validación solo comprueba su forma. No confirma su letra de control.
`NIF_LENGTH` sigue señalando longitudes incorrectas. Una comprobación local
correcta no demuestra que el identificador pertenezca a un contribuyente real.
