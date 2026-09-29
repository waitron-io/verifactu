---
title: Tu sistema de facturación (SIF)
description: Qué entiende la AEAT por sistema de facturación, y cuándo necesitas más de uno.
---

:::caution[No es asesoramiento legal ni fiscal]
Esta página resume las reglas de la AEAT para ayudarte a usar la biblioteca. Lee
[la documentación de Veri\*Factu de la AEAT](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html) para conocer las reglas, y consulta tu caso con un
asesor fiscal.
:::

## Qué es un SIF

Las reglas de la AEAT giran en torno al SIF (sistema informático de facturación): el hardware y el
software que usas para emitir facturas. Recibe los datos de las facturas, los guarda y los procesa,
dondequiera que eso ocurra: en una caja registradora, en tus propios servidores o en la nube.

La AEAT distingue un SIF de otro por tres valores:

- el NIF del emisor, `IDEmisorFactura`
- el identificador de tu software, `IdSistemaInformatico` en `SistemaInformatico`
- el número de instalación, `NumeroInstalacion` en `SistemaInformatico`

El `NIF` de `SistemaInformatico` es el NIF de quien produce el software, que no tiene por qué ser el
emisor.

Una versión nueva de tu software sigue siendo el mismo SIF. Cada SIF mantiene una cadena de
registros por cada emisor; consulta [Encadenar registros](/verifactu/es/guides/chain/).

## ¿Un SIF o varios?

**Una aplicación en varios servidores, con una sola base de datos.** La AEAT no trata este caso
directamente. Sí dice que un SIF es el hardware y el software dondequiera que se haga el proceso, y
que las partes conectadas de un sistema comparten una cadena. Así que normalmente es un solo SIF.
Aun así, debe crear los registros de uno en uno, en el orden en que se emiten las facturas.

**Un servicio en la nube para muchas empresas.** Cada conjunto separado de facturación de tu
servicio es su propio SIF, que la AEAT llama SIF virtual. Eso significa que cada empresa, y cada
tienda de una empresa que factura por separado, tiene su propio número de instalación. Pon
`IndicadorMultiplesOT` a `"S"` para un usuario que tiene más de uno de estos configurado, incluidos
los inactivos, y a `"N"` en otro caso.

**Cajas registradoras.** Una caja que emite facturas por su cuenta es su propio SIF, con su propia
cadena. Una caja solo puede formar parte de un sistema central si su conexión con ese sistema está
siempre activa y es en tiempo real.

**Trabajar sin conexión.** No puedes emitir facturas en un sistema desconectado y copiar los
registros a uno conectado al final del día. Si un problema real, como un corte de luz o una caída de
la conexión, te impide enviar, sigue facturando y envía los registros cuando se resuelva, con
`RemisionVoluntaria: { Incidencia: "S" }` en la cabecera.

**Módulos de un mismo producto.** Los módulos que funcionan juntos en tiempo real son un solo SIF
con una sola cadena, sea cual sea la serie de facturas que use cada uno. Los módulos que solo
intercambian datos de vez en cuando, por ejemplo una vez al mes, pueden contar como SIF separados.

**Dos productos a la vez.** Una empresa puede usar más de un SIF, por ejemplo para locales que no
están conectados o para líneas de negocio separadas. Cada uno tiene su propia cadena.

**Una reinstalación.** Reinstalar, aunque sea el mismo software en el mismo ordenador, crea un SIF
nuevo. Necesita un número de instalación nuevo, y su cadena empieza de nuevo.

**Pruebas.** Toda factura emitida en un SIF en producción es real, también las de prueba. La AEAT
sugiere dar a las facturas de prueba su propia serie y anularlas siempre. Para desarrollar, usa en
su lugar el entorno de pruebas de la AEAT (preproducción).

## La declaración del productor

El productor del software firma una declaración de que cumple las reglas de la AEAT, llamada
declaración responsable. La AEAT publica
[un ejemplo](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/ejemplo-declaracion-responsable.html).
La biblioteca es una parte de tu SIF; la declaración cubre el sistema entero.
