---
title: La cadena de huellas
description: Enlaza cada registro con la identidad y la huella del anterior.
---

La huella es la marca SHA-256 del registro. La cadena deja visible el orden: cada registro
identifica al anterior e incluye su huella en el cálculo de la suya. Guarda el registro anterior
de forma duradera para que un reinicio no inicie una cadena nueva por accidente.

```ts
const first = buildAltaRecord({
  ...saleInput,
  NumSerieFactura: "T01/000123",
  Encadenamiento: { PrimerRegistro: "S" },
});

const second = buildAltaRecord({
  ...nextSaleInput,
  NumSerieFactura: "T01/000124",
  Encadenamiento: {
    RegistroAnterior: { ...first.IDFactura, Huella: first.Huella },
  },
});
```

`saleInput` y `nextSaleInput` son dos ventas que comparten `SistemaInformatico`. Los cuatro campos
de `RegistroAnterior` deben salir del registro anterior guardado: `IDEmisorFactura`,
`NumSerieFactura`, `FechaExpedicionFactura` y `Huella`. Solo el primero de una cadena lleva
`PrimerRegistro`. `buildAltaRecord` calcula la huella nueva; no la calcules aparte ni cambies el
formato de los campos después.

Numera las facturas y actualiza la cadena en una transacción duradera de tu sistema. La biblioteca
no mantiene una cadena en memoria porque un fallo del proceso perdería ese estado.
