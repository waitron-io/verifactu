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

Mantén una cadena continua para cada obligado en cada SIF desplegado. Los registros de alta y de
anulación comparten esa cadena según su orden de generación. Un nuevo ejercicio o una nueva serie de
facturación no inicia otra cadena, y una tienda o un terminal no la separa solo por estar en otra
ubicación. Solo corresponde otra cadena cuando se trata de otro obligado o de una arquitectura con
un SIF realmente independiente. El paquete acepta el antecesor que le proporciones; no puede decidir
por ti esos límites del despliegue.

Antes de añadir un registro, inspecciona el antecesor que hayas leído del almacenamiento.
`validate` comprueba la huella del registro actual y la forma y el formato de la huella del puntero
al anterior; con un solo registro no puede demostrar que el anterior estuviera bien enlazado con el
que lo precedía ni comparar la hora de generación de ese antecesor guardado con la nueva
incorporación. Realiza esas comprobaciones históricas junto a la transacción duradera de la cadena.

La FAQ 15 para desarrolladores de la AEAT describe comprobaciones automáticas y registros de
eventos adicionales para los SIF NO Veri*Factu. Este paquete crea registros Veri*Factu y no
implementa firmas NO Veri*Factu, registros de eventos, informes de anomalías ni control del reloj.
