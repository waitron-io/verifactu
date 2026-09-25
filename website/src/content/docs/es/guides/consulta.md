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

const recibidas = await client.consultar(
  { Destinatario: { NombreRazon: "Cliente SL", NIF: "B12345674" } },
  {
    Ejercicio: "2026",
    Periodo: "07",
    Contraparte: cabecera.ObligadoEmision,
    RangoFechaExpedicion: { Desde: "01-07-2026", Hasta: "31-07-2026" },
  },
);
```

Indica en `Ejercicio` un año de cuatro dígitos y en `Periodo` un mes de dos dígitos, de `"01"`
a `"12"`, como en la consulta anterior. El cliente rechaza cualquiera de los dos campos si tiene
un formato incorrecto antes de enviar el XML a la AEAT. Si calculas el mes a partir de una fecha,
rellénalo con un cero en lugar de enviar `"7"`.

`NumSerieFactura` y `FechaExpedicionFactura` acotan la consulta; omítelos para recorrer el
periodo.
Usa `RangoFechaExpedicion` con `Desde` y `Hasta` para acotar un intervalo de fechas. Es
una alternativa a `FechaExpedicionFactura`; el serializador rechaza una solicitud que envíe ambos.
Escribe cada fecha como `DD-MM-YYYY`, incluida la de `ClavePaginacion`. El cliente comprueba este
formato antes del envío, y el analizador de solicitudes XML también lo comprueba. Una fecha como
`31-02-2026` tiene ese formato, pero no existe en el calendario; comprueba las fechas reales en tu
aplicación.
Usa entre 1 y 60 caracteres para `NumSerieFactura`. Usa `RefExterna` si guardaste una referencia
propia en el registro; puede estar vacío, pero no superar los 60 caracteres. El cliente comprueba
estos límites, incluido el número de factura de `ClavePaginacion`, antes del envío porque el
esquema de AEAT rechaza valores más largos.

Usa `Contraparte` con `NombreRazon` y el `NIF` o `IDOtro` del cliente para buscar sus facturas.
`SistemaInformatico` limita el resultado a una instalación. Indica `NombreRazon`, `NIF` o
`IDOtro`, `IdSistemaInformatico` y `NumeroInstalacion`. El nombre del software, la versión y los
indicadores de uso son opcionales.

Pide `DatosAdicionalesRespuesta` solo cuando necesites el nombre del emisor o los datos del
software en cada resultado. `ConsultaLR.xsd` de la AEAT indica que estos campos pueden ralentizar
la respuesta. La misma norma exige que omitas `MostrarSistemaInformatico` o uses `"N"` si consultas
como destinatario. Los tipos de `SuministroInformacion.xsd`, que importa esta norma, restringen
ambos indicadores a `"S"` o `"N"`. El cliente rechaza los demás valores antes del envío y coloca
las opciones válidas después de `FiltroConsulta` en el XML.

El destinatario usa otra cabecera de consulta e identifica al emisor como contraparte, como muestra
la consulta `recibidas` anterior.

Indica `IndicadorRepresentante: "S"` junto a `ObligadoEmision` cuando el titular del certificado
consulta como representante del emisor. `"N"` no es válido en una consulta; omite el indicador
si no consultas como representante. No lo incluyas en una consulta como destinatario.

Cuando `IndicadorPaginacion` sea `"S"`, envía la `ClavePaginacion` recibida en la
siguiente consulta. El analizador comprueba que `ResultadoConsulta` sea `ConDatos` o `SinDatos`,
que `IndicadorPaginacion` sea `S` o `N`, y que una página `S` lleve una clave con sus tres campos
de identidad de factura no vacíos. Si falta esa clave o está incompleta, lanza un error para que
no repitas la primera página. Una página final `N` no necesita clave; si la respuesta la incluye,
el analizador la ignora y conserva los registros de esa página. El CSV del envío no se puede
recuperar aquí: la consulta no lo devuelve.
