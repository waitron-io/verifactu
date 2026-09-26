---
title: ¿Esto es un SIF?
description: Diferencia entre una biblioteca de protocolo y un sistema de facturación desplegado.
---

**Esta biblioteca ayuda a construir sistemas informáticos de facturación (SIF), pero no es un SIF
por sí sola.** Un SIF es el sistema que tú despliegas. Sus obligaciones dependen de la modalidad y
de la arquitectura que utilices. El código fuente, por sí solo, no puede elegirlas ni demostrarlas.

Tu despliegue debe guardar de forma duradera los números y el estado de la cadena, repetir envíos
sin crear nuevas identidades, conservar las respuestas y el CSV de la AEAT en cuanto lleguen y
aportar el acceso y la declaración responsable exigidos para esa instalación. La biblioteca
proporciona funciones para los registros y el protocolo; tú diseñas y operas el sistema completo.

## Decide si se aplica el reglamento antes de crear registros

La AEAT considera SIF al conjunto de hardware y software que admite datos de facturación, los
conserva y los procesa para obtener resultados tributarios, aunque cada paso se ejecute en un lugar
distinto. Un procesador de textos o una hoja de cálculo que solo introduce, imprime y conserva
facturas puede quedar fuera de esa definición. La misma hoja puede formar parte de un SIF si una
macro convierte esas facturas en un libro tributario.

Este paquete no decide si un obligado o una operación está sujeto al RRSIF. La adscripción al SII,
las normas forales, el territorio y el impuesto del obligado, las exoneraciones y la naturaleza
jurídica del documento dependen de hechos ajenos al registro. Decide ese ámbito antes de usar el
paquete. La ausencia del QR tributario afecta al cumplimiento del emisor; por sí sola, no decide si
el destinatario puede deducir el IVA soportado.

## Conserva de forma permanente las identidades de instalación y factura

Asigna `NumeroInstalacion` fuera de este paquete y no lo reutilices nunca para el mismo obligado a
emitir facturas, ni siquiera después de reinstalar el mismo producto. En un servicio multiempresa,
calcula `IndicadorMultiplesOT` para el usuario actual: usa `"S"` cuando ese usuario tenga más de
una facturación configurada, incluidas las inactivas. No lo deduzcas del número total de clientes
del servicio.

Mantén los borradores, las proformas y las facturas importadas fuera de la ruta que construye tus
propios registros. Un borrador no lleva QR tributario ni registro de alta. Si tu SIF desplegado crea
borradores, enlázalos con la factura definitiva o consérvalos bajo tus propios controles cuando no
llegue a emitirse una factura. Un registro importado sigue siendo atribuible a su SIF de origen. Una
vez que expides una factura, también si es de formación, no puedes borrar y reutilizar su identidad
formada por emisor, serie/número y fecha de expedición; anúlala mediante el flujo normal cuando
corresponda.

## Distingue el almacenamiento operativo de la obligación de cada modalidad

La [FAQ para desarrolladores de la AEAT](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf)
dice que la conservación local de los registros remitidos no se regula por separado para un SIF
Veri*Factu porque la AEAT los conserva. Eso no hace seguro un
proceso sin estado: guarda de forma duradera los números asignados, el registro terminado, la
posición de la cadena, los reintentos, la respuesta de la AEAT y el CSV para poder reanudar sin
crear otra identidad. También debes conservar las facturas completas y lo que exija tu sistema
contable más amplio.

Este paquete no implementa firmas NO Veri*Factu, registros de eventos, informes de anomalías,
pantallas de identidad del operador, impresión de facturas ni declaraciones responsables. Si tu
producto necesita esas funciones, constrúyelas y certifícalas en el SIF desplegado; un XML válido no
demuestra por sí solo el cumplimiento del sistema completo.

Delegar la expedición material de una factura no transfiere la responsabilidad del obligado sobre
el cumplimiento. Cuando el destinatario o un tercero expida la factura, tu despliegue debe acreditar
la autorización, identificar al operador y aplicar el tratamiento contable correspondiente. El
paquete solo representa los campos del registro. Tu SIF desplegado también debe permitir que una
inspección acceda a los datos tributarios pertinentes sin exponer otros datos confidenciales; un
serializador XML no puede proporcionar esa separación de acceso.

Lee la [procedencia y la advertencia](https://github.com/waitron-io/verifactu/blob/main/PROVENANCE.md)
antes de tratar cualquier ejemplo como un diseño completo de cumplimiento.
