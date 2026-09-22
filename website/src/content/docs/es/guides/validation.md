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
