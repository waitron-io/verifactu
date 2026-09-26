---
title: Consultar a la AEAT
description: Busca una factura o recorre los registros de un periodo.
---

Usa `consultar` para comparar tu copia con el registro guardado por la AEAT, especialmente después
de una respuesta de duplicado sin detalle del estado almacenado. El periodo es obligatorio incluso
si conoces el número de factura.

Usa el periodo de imputación de la factura: el año y mes de `FechaOperacion` cuando el registro
incluya ese campo y, en caso contrario, los de `FechaExpedicionFactura`. Esta regla también se
aplica cuando acotas la consulta por número y fecha de expedición. Si indicas el mes de expedición
para un registro cuya operación pertenece a otro mes, la AEAT no lo devuelve en ese periodo.

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
`ClavePaginacion.IDEmisorFactura` debe contener un NIF de nueve caracteres; el cliente comprueba
su longitud antes del envío.

Usa `Contraparte` con `NombreRazon` y el `NIF` o `IDOtro` del cliente para buscar sus facturas.
`SistemaInformatico` limita el resultado a una instalación. Indica `NombreRazon`, `NIF` o
`IDOtro`, `IdSistemaInformatico` y `NumeroInstalacion`. El nombre del software, la versión y los
indicadores de uso son opcionales.
El cliente comprueba estas identidades y los límites de texto del esquema antes del envío. Para
`IDOtro`, usa un código de país admitido por la AEAT y un tipo de identificación entre `02` y
`07`. Indica emisor o destinatario en la cabecera de consulta, nunca ambos.

Pide `DatosAdicionalesRespuesta` solo cuando necesites el nombre del emisor o los datos del
software en cada resultado. `ConsultaLR.xsd` de la AEAT indica que estos campos pueden ralentizar
la respuesta. La misma norma exige que omitas `MostrarSistemaInformatico` o uses `"N"` si consultas
como destinatario. Los tipos de `SuministroInformacion.xsd`, que importa esta norma, restringen
ambos indicadores a `"S"` o `"N"`. El cliente rechaza los demás valores antes del envío y coloca
las opciones válidas después de `FiltroConsulta` en el XML.

El destinatario usa otra cabecera de consulta. Incluye al emisor como `Contraparte` cuando quieras
acotar la búsqueda, como muestra la consulta `recibidas`. En la anotación del esquema, `Obligado` y
`Destinatario` nombran a la parte cuya identidad corresponde a este bloque; no hacen que el bloque
sea obligatorio. El XSD deja `Contraparte` como opcional, y la biblioteca también. Esto demuestra
la forma del XML, no qué consultas amplias autoriza la AEAT al destinatario. Comprueba ese
comportamiento en preproducción antes de depender de una consulta sin contraparte.

Indica `IndicadorRepresentante: "S"` junto a `ObligadoEmision` cuando el titular del certificado
consulta como representante del emisor. `"N"` no es válido en una consulta; omite el indicador
si no consultas como representante. No lo incluyas en una consulta como destinatario.

Cuando `IndicadorPaginacion` sea `"S"`, envía la `ClavePaginacion` recibida en la
siguiente consulta. El analizador comprueba que `ResultadoConsulta` sea `ConDatos` o `SinDatos`,
que `IndicadorPaginacion` sea `S` o `N`, y que una página `S` lleve una clave con sus tres campos
de identidad de factura presentes y dentro de los límites del esquema para el NIF, el número de
factura y el formato de fecha. También sigue los estados almacenados del XSD de respuesta actual:
`Correcto`, `AceptadoConErrores` y `Anulado`. El ejemplo del PDF de descripción del servicio usa
`Correcta`, pero ese literal antiguo no pasa el XSD actual y el analizador lo rechaza. Aplica los
mismos límites a cada identidad de factura devuelta. Si
falta la clave de continuación o sus datos no son válidos, lanza un error para que no repitas la
primera página. Una página final `N` no necesita clave; si la respuesta la incluye,
el analizador la ignora y conserva los registros de esa página. También rechaza una respuesta con
más de los 10.000 registros que permite el esquema.
Si un registro incluye `DatosPresentacion`, el analizador exige el NIF del presentador, la fecha
y hora de presentación y el elemento de identificación de petición. El esquema permite que este
último esté vacío. Conserva el texto de la fecha y hora después de comprobar su formato XML Schema,
y aplica la misma comprobación a la fecha y hora obligatoria de última modificación. Los códigos de
error deben usar texto entero y caber en el rango entero exacto de JavaScript; la descripción del
error admite como máximo 500 caracteres.
Si un registro devuelto tiene una identidad de factura no válida, falla el análisis de toda la
página; no se devuelven sus otros registros ni la clave. Captura la respuesta XML en tu capa de
transporte si necesitas diagnosticar una respuesta de la AEAT que no cumple el esquema.
El CSV del envío no se puede recuperar aquí: la consulta no lo devuelve.
