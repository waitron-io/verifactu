---
title: Comprobar registros
description: Encuentra los problemas antes que la AEAT y distingue los errores de las advertencias.
---

La biblioteca comprueba un registro con muchas de las normas que publica la AEAT antes de que lo
envíes. Cubre el formato de los campos, los NIF, los importes y los totales, las fechas, los tipos de
factura y las combinaciones de campos que la AEAT permite.

## Errores y advertencias

Cada problema tiene una gravedad:

- Un **error** significa que el registro incumple el formato XML de la AEAT, o una norma que la AEAT
  indica como motivo para rechazar un registro. Corrígelo antes de enviarlo.
- Una **advertencia** significa que incumple una norma que la AEAT indica como un error que aun así
  acepta: la AEAT guarda el registro, pero lo marca. Revísalo.

`assertValid` lanza un `VerifactuValidationError` si hay algún error, e ignora las advertencias.
`validate` devuelve todos los problemas, lo que viene bien para un formulario o un log:

```ts
import { validate } from "@waitron/verifactu";

const broken = { ...record, SistemaInformatico: { ...software, IdSistemaInformatico: "001" } };

for (const issue of validate(broken)) {
  console.log(issue.severity, issue.code, issue.field); // error ID_SISTEMA_LENGTH SistemaInformatico.IdSistemaInformatico
}
```

Cada problema tiene un `code` que puedes comparar en tu código, el `field` al que afecta y un
`message` legible. El error lanzado tiene la misma lista en su propiedad `issues`:

```ts
import { assertValid, VerifactuValidationError } from "@waitron/verifactu";

try {
  assertValid(broken);
} catch (error) {
  if (error instanceof VerifactuValidationError) {
    console.log(error.issues.length); // 1
  }
}
```

## Primero crea, luego comprueba

Comprueba el registro que devuelve el constructor, no los datos que le pasaste. Si después de crear
el registro cambias un campo que entra en la huella, la huella deja de coincidir y recibes una
advertencia `HUELLA_MISMATCH`.

## Comprobaciones que dependen de la fecha de hoy

Algunas normas dependen de la fecha actual. Por ejemplo, una factura no puede tener fecha futura.
Pasa `{ now }` para controlar el reloj en las pruebas:

```ts
const lastYear = new Date("2025-07-20T12:00:00Z");
console.log(validate(record, { now: lastYear }).some((issue) => issue.severity === "error")); // true
```

## Lo que la comprobación no puede decirte

- Si un NIF pertenece a una empresa real y dada de alta. Eso solo lo sabe la AEAT.
- Si elegiste los códigos de impuesto correctos para la venta. Comprueba que los códigos se pueden
  usar juntos, no que encajen con los hechos.
- Si tu cadena guardada está completa. Consulta [Encadenar registros](/verifactu/es/guides/chain/).

La respuesta de la AEAT tiene la última palabra sobre cada registro, así que léela aunque la
comprobación haya pasado.

## Comprobaciones al enviar

`client.submit` también comprueba el lote antes de enviar nada. Lanza un error si el NIF de la
cabecera no coincide con el emisor de todos los registros, o si el lote está vacío o tiene más de
1.000 registros.
