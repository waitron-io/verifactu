---
title: Modalidades de envío y representación
description: Los representantes y los requerimientos de la AEAT requieren otras reglas y servicios.
---

La [guía de envío](/verifactu/es/guides/submit/) usa la remisión voluntaria VERI*FACTU.
Comprueba estas diferencias si cambian el obligado, el titular del certificado o las
instrucciones de la AEAT.

Añade `Representante: { NombreRazon, NIF }` a `cabecera` solo si un representante presenta los
registros. Una `Cabecera` puede incluir registros de varios SIF del mismo contribuyente en un
envío, porque cada registro lleva su propio `SistemaInformatico`. Cada alta debe repetir
`cabecera.ObligadoEmision.NIF` en `IDEmisorFactura`; el serializador se detiene antes del envío si
ambos valores difieren.

Ese campo XML no concede por sí solo autorización para actuar por el obligado. Tu despliegue debe
contar por separado con el acuerdo de colaboración social aplicable, la autorización del cliente y
un certificado que la AEAT acepte para esa representación. Si un proveedor de software usa la vía
de colaboración social descrita por la FAQ pública, confirma el trámite censal de tipo 017 vigente
y conserva la autorización firmada en la forma que acepte la AEAT. La validación local del NIF solo
prueba la forma del texto; no acredita que el acuerdo ni la representación estén vigentes.

Para un envío voluntario VERI*FACTU ordinario, deja ausentes los bloques de remisión de la
cabecera. Puedes añadir `RemisionVoluntaria: { FechaFinVeriFactu, Incidencia }` cuando proceda.
Si envías registros no verificables por requerimiento de la AEAT, usa en su lugar
`RemisionRequerimiento: { RefRequerimiento, FinRequerimiento }`; la referencia es obligatoria.
No combines ambos bloques. La AEAT mantiene los envíos bajo requerimiento en un servicio
separado: elige `SOAP_ENDPOINTS_REQUERIMIENTO` o `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO` para ese
cliente, nunca el par voluntario `SOAP_ENDPOINTS` que se muestra abajo. La consulta solo está
disponible para los envíos voluntarios VERI*FACTU. La biblioteca representa ese XML, pero no
determina la modalidad de tu SIF ni confirma que la AEAT haya emitido el requerimiento.

La guía enlazada construye registros nuevos para el envío voluntario VERI*FACTU. Ante un
requerimiento, envía los registros tal como los conservó tu SIF, sin reconstruirlos ni cambiar
sus datos de negocio para satisfacer `assertValid`. La AEAT admite los errores de validación de
negocio en esos registros, salvo los de identificación por NIF o `IDOtro`, que todavía pueden
causar su rechazo. Revisa cada resultado, pero no subsanes los errores de negocio de los
registros conservados. En el último lote indica `FinRequerimiento: "S"` en
`RemisionRequerimiento`, incluso si solo hay un lote. No puedes consultar esos registros mediante
el servicio de consulta de los envíos voluntarios.

Un SIF Veri*Factu remite cada alta al expedir la factura. No expidas facturas en un sistema sin
conexión para copiar sus registros a otro sistema y enviarlos al final del día. Si dos ubicaciones
funcionan como SIF independientes, cada una mantiene su propia ruta de remisión directa y su cadena.

El serializador comprueba la forma del NIF del obligado y del representante antes del envío.
También comprueba el límite de 18 caracteres de la referencia y una `FechaFinVeriFactu` indicada:
su año debe ser el actual o el anterior y, desde el 1 de enero de 2027, la fecha debe tener la
forma `31-12-20XX`. La AEAT usa su propio reloj y censo, por lo que su respuesta es la fuente
definitiva. Un lote admite entre 1 y 1000 bloques separados, cada uno con un alta o una anulación.
El analizador también rechaza los bloques incorrectos.
