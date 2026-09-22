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

Para un identificador fiscal español de nueve caracteres, `NIF_CONTROL` señala un carácter de
control incorrecto o un formato desconocido. Comprueba el DNI, el NIE X/Y/Z, los NIF de entidades y
los NIF K/L/M con cuerpo numérico. La forma nueva de K/L/M puede tener letras en sus siete
caracteres centrales; la validación comprueba su forma, pero no puede confirmar localmente su
letra de control. `NIF_LENGTH` sigue señalando longitudes incorrectas. Una comprobación local
correcta no demuestra que el identificador pertenezca a un contribuyente real.
