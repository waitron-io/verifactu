---
title: Consultar a la AEAT
description: Busca una factura o recorre los registros de un periodo.
---

Usa `consultar` para comparar tu copia con el registro guardado por la AEAT, especialmente después
de una respuesta de duplicado sin detalle del estado almacenado. El periodo es obligatorio incluso
si conoces el número de factura.

```ts
const result = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  NumSerieFactura: record.IDFactura.NumSerieFactura,
  FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
});

for (const stored of result.registros) {
  console.log(stored.IDFactura, stored.EstadoRegistro);
  console.log(stored.DatosRegistroFacturacion.Huella);
}

const detailed = await client.consultar(cabecera, {
  Ejercicio: "2026",
  Periodo: "07",
  SistemaInformatico: {
    NombreRazon: sistema.NombreRazon,
    NIF: sistema.NIF,
    IdSistemaInformatico: sistema.IdSistemaInformatico,
    NumeroInstalacion: sistema.NumeroInstalacion,
  },
  DatosAdicionalesRespuesta: {
    MostrarNombreRazonEmisor: "S",
    MostrarSistemaInformatico: "S",
  },
});
console.log(detailed.registros[0]?.DatosRegistroFacturacion.NombreRazonEmisor); // Example SL
console.log(Boolean(detailed.registros[0]?.DatosRegistroFacturacion.SistemaInformatico)); // true
```

`NumSerieFactura` y `FechaExpedicionFactura` acotan la consulta; omítelos para recorrer el
periodo. Usa `RefExterna` si guardaste una referencia propia en el registro. Usa `Contraparte`
con `NombreRazon` y el `NIF` o `IDOtro` del cliente para buscar sus facturas.
`SistemaInformatico` limita el resultado a una instalación. Debes indicar el nombre, la
identificación, el ID del sistema y el número de instalación; la versión y los indicadores de uso
son opcionales.

Pide `DatosAdicionalesRespuesta` solo cuando necesites el nombre del emisor o los datos del
software en cada resultado. Estos campos pueden ralentizar la respuesta de la AEAT. Si consultas
como destinatario, omite `MostrarSistemaInformatico` o usa `"N"`, como exige la AEAT. El cliente
coloca estas opciones después de `FiltroConsulta` en el XML.

Cuando `IndicadorPaginacion` sea `"S"`, envía la `ClavePaginacion` recibida en la
siguiente consulta. El CSV del envío no se puede recuperar aquí: la consulta no lo devuelve.
