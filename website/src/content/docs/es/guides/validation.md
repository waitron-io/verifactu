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
`05`, `06`, `08` y `09`. `validate` omite ambas comprobaciones si alguna línea usa uno de esos
regímenes. La exclusión se aplica al registro completo, por lo que una factura con regímenes mixtos
no produce un aviso por totales incoherentes. La preproducción de la AEAT confirmó este comportamiento
para un registro que combinaba los regímenes `01` y `03`.

`validate` también comprueba que el tipo de factura corresponda con la presencia de
`Destinatarios` y que las líneas de IVA, IPSI e IGIC incluyan `ClaveRegimen`, mientras que las de
otros impuestos lo omitan. No decide qué régimen describe tu operación comercial, pero sí rechaza
los códigos que no figuran en la lista publicada para ese impuesto y las combinaciones que
incumplen las reglas específicas del régimen. Examina la respuesta de la AEAT para cada registro
enviado.

El IPSI tiene una transición con fecha. Un régimen IPSI ausente o desconocido genera un aviso hasta
el 31 de diciembre de 2026, porque durante ese periodo la AEAT acepta el registro con errores. Pasa
a ser un error el 1 de enero de 2027, cuando la AEAT empieza a rechazarlo. Puedes pasar `{ now }` a
`validate` o `assertValid` para probar ambos lados de ese límite. El límite usa ese instante con el
desfase numérico de `FechaHoraHusoGenRegistro`, por lo que la medianoche sigue la fecha local
declarada en el registro. Una marca temporal incorrecta ya genera `FECHA_HORA_FORMAT`; en ese caso,
el problema del IPSI sigue siendo un aviso para no añadir un segundo error derivado de la fecha.

Los campos de rectificación se comprueban en conjunto. Los valores `S` y `X` de `RechazoPrevio`
exigen `Subsanacion: "S"`; `FacturasRectificadas` solo está permitido en `R1`–`R5`;
`FacturasSustituidas`, solo en `F3`; e `ImporteRectificacion` es obligatorio, y solo está permitido,
con `TipoRectificativa: "S"`. Una agrupación de referencias presente debe contener al menos una
factura. Cada factura referenciada recibe comprobaciones locales del NIF, del número de factura de
1–60 caracteres y de una fecha real. El alfabeto más estrecho y seguro para QR de la factura
principal no se aplica a estas referencias porque nunca entran en el QR. La AEAT sigue siendo quien
confirma si un NIF está censado.

En un alta, `FechaExpedicionFactura` no puede ser anterior al 28 de octubre de 2024 ni posterior a
la fecha actual. Tampoco puede preceder a `FechaOperacion` en una línea de IVA o IGIC, salvo que
esa línea use el régimen `14` o `15`. `FechaOperacion` no puede tener más de 20 años ni ser
posterior al final del año natural siguiente. Una fecha de operación futura en IVA o IGIC también
se limita a los regímenes `14` y `15`. En un registro mixto, cada línea aplicable de IVA o IGIC debe
cumplir esa excepción. Las comprobaciones de fecha actual usan el desfase numérico de
`FechaHoraHusoGenRegistro`, no la zona horaria del ordenador. En pruebas o aplicaciones con un reloj
controlado puedes pasar `{ now }` como segundo argumento de `validate` o `assertValid`.

Los indicadores legales también se contrastan con `TipoFactura`:
`FacturaSimplificadaArt7273: "S"` solo se permite en `F1`, `F3` y `R1`–`R4`, mientras que
`FacturaSinIdentifDestinatarioArt61d: "S"` solo se permite en `F2` y `R5`. `Macrodato` debe estar
presente cuando el valor absoluto de `ImporteTotal` alcance 100.000.000 €. La regla oficial exige
el campo; como el XSD permite tanto `S` como `N`, la validación local no sustituye esa regla de
presencia por otra sobre su valor.

En una expedición por terceros, `EmitidaPorTerceroODestinatario: "T"` exige `Tercero`; `"D"` exige
`Destinatarios`; y `Tercero` está prohibido en cualquier otro caso. El tercero debe usar exactamente
uno de `NIF` e `IDOtro`. La validación local comprueba el formato del NIF español y que sea distinto
del emisor de la factura, la restricción española de `IDOtro`, la prohibición de `IDType: "07"` y
los formatos en mayúsculas de NIF-IVA publicados por la AEAT para `IDType: "02"`, incluida la
transición fechada GB/XI. Solo la AEAT puede confirmar que un NIF o NIF-IVA bien formado está censado.

Cada destinatario también debe usar exactamente uno de `NIF` e `IDOtro`. En los destinatarios,
`IDType: "07"` exige `CodigoPais: "ES"`; los identificados con país español solo pueden usar
`IDType: "03"` o `"07"`; y `IDType: "02"` debe cumplir un formato NIF-IVA publicado y solo puede
aparecer en `F1`, `F3` o `R1`–`R4`. Esos tipos de factura son también los únicos que admiten
registros expedidos por el destinatario (`"D"`), porque `F2` y `R5` prohíben `Destinatarios`.

En las líneas de detalle IVA `S1`, `validate` comprueba la lista oficial de tipos y los periodos
fechados de los tipos temporales del `5`, `2` y `7,5` por ciento. Si incluyes
`TipoRecargoEquivalencia`, su valor debe corresponder tanto a `TipoImpositivo` como a la fecha
efectiva de la operación. Esa fecha es `FechaOperacion` o, si falta, `FechaExpedicionFactura`.

`BaseImponibleACoste` solo está disponible para el régimen `06`, IPSI u otro impuesto. Las líneas
de inversión del sujeto pasivo `S2` exigen un tipo de factura admitido y valores cero en
`TipoImpositivo` y `CuotaRepercutida`. Las líneas IVA `N1`/`N2` deben omitir tipos, cuotas
repercutidas y recargos de equivalencia. Todas las líneas exentas deben omitir esos campos. Los
códigos de exención se contrastan con las listas IVA/IGIC y las restricciones del régimen 01; los
destinatarios informados en una línea IVA `E5` deben usar `IDOtro`. Por último, `Cupon: "S"` solo es
válido en `R1` y `R5`.

La validación específica de regímenes cubre las condiciones publicadas sobre operación, tipo,
base a coste, tipo de factura, identificación del destinatario y fecha de operación para los
regímenes IVA/IGIC `02`, `03`, `04`, `06`, `07`, `08`, `10`, `11`, `14` y el régimen IGIC `20`.
En particular, el régimen `14` exige una `FechaOperacion` posterior a la fecha de expedición y
destinatarios cuyo NIF empiece por `P`, `Q`, `S` o `V`.

Cada línea `S1` debe incluir `TipoImpositivo` y `CuotaRepercutida`. Salvo que el registro sea una
rectificación por diferencias (`TipoRectificativa: "I"`) o una factura `R2`/`R3`, la cuota debe
tener el mismo signo que la base aplicable y ser igual a esa base multiplicada por el tipo dentro
del margen de ±10 € de la AEAT. Si existe `BaseImponibleACoste`, esa es la base aplicable; en caso
contrario, la comprobación usa `BaseImponibleOimporteNoSujeto`. Una cuota cero solo es válida si la
base aplicable o el tipo también es cero. No se permite una `CuotaRepercutida` distinta de cero
fuera de `S1`. Los errores más específicos ya existentes señalan la misma infracción para `S2`, IVA
`N1`/`N2` y líneas exentas, para que recibas un solo problema útil en vez de mensajes duplicados.

Mantén `IDEmisorFactura` igual a `Cabecera.ObligadoEmision.NIF`. `serializeEnvio` rechaza el lote
si ambos valores difieren, antes de crear el XML. La AEAT permite un conjunto más amplio de
caracteres ASCII imprimibles en `NumSerieFactura`, pero esta biblioteca solo acepta letras,
dígitos, `/`, `_`, `.` y `-`. Este alfabeto más reducido evita ambigüedades cuando el número de
factura pasa a ser un parámetro de la consulta QR.

Para un identificador fiscal español de nueve caracteres, `NIF_CONTROL` señala un carácter de
control incorrecto o un formato desconocido. Comprueba el DNI, el NIE X/Y/Z, los NIF de entidades y
los NIF K/L/M con cuerpo numérico. La forma nueva de K/L/M puede tener letras en sus siete
caracteres centrales; la validación solo comprueba su forma. No confirma su letra de control.
`NIF_LENGTH` sigue señalando longitudes incorrectas. Una comprobación local
correcta no demuestra que el identificador pertenezca a un contribuyente real.
`NOMBRE_SISTEMA_LENGTH` señala un `SistemaInformatico.NombreSistemaInformatico` que supera el
máximo de 30 caracteres del esquema.
