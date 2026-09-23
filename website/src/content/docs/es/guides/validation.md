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
`05`, `06`, `08` y `09`. Si alguna línea usa uno de esos regímenes, la AEAT omite ambas
comprobaciones para todo el registro, y `validate` hace lo mismo. En caso contrario, compara los
totales con todas las líneas.

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
`NOMBRE_SISTEMA_LENGTH` señala un `SistemaInformatico.NombreSistemaInformatico` que supera el
máximo de 30 caracteres del esquema.
