# Technical index review, 17 November 2026

The source-watch alert [#153](https://github.com/waitron-io/verifactu/issues/153) reported one
changed fingerprint: AEAT's
[technical information index](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html).
A read-only check in an `ubuntu:24.04` container against baseline commit `63d58ed` reproduced
it, `62dff6d0…` to `1961d830…`, and reported no other change among the 43 sources.

The refresh that accepted it also wrote new gzip copies of the two watched GitHub commits'
metadata. Neither commit changed: their uncompressed JSON is identical to the earlier copies.
Only the compressed bytes differ: these copies were compressed on Linux and the October ones on
macOS (the gzip header's operating-system byte is 3 here and 19 there).

## What changed

`diff` of the archived normalized text
([before](../archive/aeat-technical-index/62dff6d06ccde7102a1ec0602a2fbef7e7a850ab594bddcd98807622dbfe3c65.txt),
[after](../archive/aeat-technical-index/1961d830d944be1bd1850d6003733749b14814d0d0f6c7f24d703ba9f46d96b7.txt))
shows two differences and nothing else:

1. The word “Documentación” now appears before the “Siguiente” link to the next page, “Diseños
   de registro”.
2. The “Portal de Pruebas externas” link moved from `https://preportal.aeat.es` to
   `https://preportal.aeat.es/PRE-Exteriores/Inicio/_menu_/VERI_FACTU___Sistemas_Informaticos_de_Facturacion/VERI_FACTU___Sistemas_Informaticos_de_Facturacion.html`,
   the VERI\*FACTU section of the same test portal.

Both addresses answered HTTP 200 on 17 November. Neither address appears in this library's code,
tests or guides (`git grep preportal -- ':!sources/archive' ':!sources/reviews'` finds nothing),
and every other link on the index, including those to the record designs, WSDL, schemas and
specifications, is unchanged. No code, schema, fixture or documentation change follows from this
revision.
