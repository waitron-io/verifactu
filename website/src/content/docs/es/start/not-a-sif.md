---
title: ¿Esto es un SIF?
description: Diferencia entre una biblioteca de protocolo y un sistema de facturación desplegado.
---

**Esta biblioteca ayuda a construir sistemas informáticos de facturación (SIF), pero no es un SIF
por sí sola.** Un SIF es el sistema que tú despliegas. Sus obligaciones incluyen conservar los
registros, impedir que se alteren sin dejar rastro y permitir el acceso a ellos. El código fuente, por
sí solo, no puede cumplirlas.

Tu despliegue debe guardar de forma duradera los números y el estado de la cadena, repetir envíos
sin crear nuevas identidades, conservar las respuestas y el CSV de la AEAT en cuanto lleguen y
aportar el acceso y la declaración responsable exigidos para esa instalación. La biblioteca
proporciona funciones para los registros y el protocolo; tú diseñas y operas el sistema completo.

Lee la [procedencia y la advertencia](https://github.com/waitron-io/verifactu/blob/main/PROVENANCE.md)
antes de tratar cualquier ejemplo como un diseño completo de cumplimiento.
