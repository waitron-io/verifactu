# Keeping the source checks current

AEAT can revise a PDF, a schema, or an FAQ page without changing its URL. The weekly
`VeriFactu source watch` workflow downloads each source and compares its fingerprint with
[`watch-baseline.json`](watch-baseline.json). It opens or updates a GitHub issue when content
changes or a source becomes unavailable. It never accepts a new fingerprint automatically.

The watch covers AEAT's technical index, all 18 pages currently linked by its FAQ index,
the developer FAQ, the service, hash, QR and validation documents, the validation error-code
list, the three schema namespace URLs, and all six WSDL/XSD artifacts at both the test and
production URLs published in the service description's annexes 7 and 8. It also watches the current commits of `borjamrd/verifactu-conformance` and
`inoguerols/verifactu`. The first of these is a third-party package of examples from AEAT's
PDFs, not an AEAT-hosted test suite. The AEAT documents remain authoritative.

If the workflow raises an issue, open the linked source and inspect what changed. Update
code, tests and documentation if the change affects this library. Then run:

```sh
npm ci
node scripts/source-watch.mjs --refresh
node scripts/source-watch.mjs
```

Commit the new baseline with the change it represents. HTML fingerprints include the page's
main text and links, so navigation or footer changes should not cause an alert. PDF and schema
fingerprints cover the downloaded bytes. A new FAQ page changes the index fingerprint; add
the new page to `scripts/source-watch.mjs` before refreshing the baseline.

## The bundled FNMT certificate

[`fnmt-ac-componentes-informaticos.pem`](fnmt-ac-componentes-informaticos.pem) is FNMT-RCM's
"AC Componentes Informáticos" intermediate certificate. It is issued by "AC RAIZ FNMT-RCM",
signed with SHA-1 (`sha1WithRSAEncryption`), and valid until 27 June 2028. Its SHA-256
fingerprint is
`DB:0D:A1:60:32:F1:64:3A:24:96:FD:E7:42:E2:BB:E8:1D:AC:A5:8C:D7:61:20:61:42:0E:15:4C:E1:BC:E2:BD`.

The hash, QR and validation PDFs are on `www.agenciatributaria.es`, whose certificate chain
runs through this intermediate. OpenSSL 3 refuses its SHA-1 signature, so curl on GitHub's
Ubuntu runner failed with error 60, "CA signature digest algorithm too weak". The script passes
this file to curl with `--cacert`, and curl then accepts a chain that ends at this intermediate.

Measured on 2026-10-06 in an `ubuntu:24.04` container (curl 8.5.0, OpenSSL 3.0.13): with
`--cacert`, curl downloaded all three PDFs, still refused a self-signed, a wrong-host and an
expired certificate on other sites, and still verified an unrelated site through its system
certificate folder. So on Ubuntu the file adds a trust anchor rather than replacing the system
ones; a curl built without a system certificate folder would trust only this file.

The test in `scripts/source-watch.test.mjs` pins the fingerprint. Renew the file when it nears
expiry, or when the watch starts failing on those three PDFs with curl error 60:

1. Run `openssl s_client -connect www.agenciatributaria.es:443 -showcerts` to see the chain,
   and copy FNMT's current intermediate into the file.
2. Check it with
   `openssl x509 -in sources/fnmt-ac-componentes-informaticos.pem -noout -subject -issuer -dates -fingerprint -sha256`.
3. Update the fingerprint in the test, and the fingerprint and expiry date in this section.

## Live AEAT checks

The `AEAT preproduction integration` workflow runs on the first of each month once you enable it.
It submits one small test alta and exercises every VERI*FACTU request available with the configured
personal or representative certificate. The checks cover all consulta filters, issuer and recipient
headers, both expanded-response options, a pagination cursor, and the JSON QR lookup. The recipient
header is an authorised probe for the certificate holder and may return `SinDatos`; querying the
submitted invoice as its configured customer requires that customer's certificate or an AEAT
authorisation for it. The workflow then waits for AEAT's next-submission interval, submits a chained
anulación, and confirms the final consulta reports the invoice as `Anulado` with the cancellation
record's hash. You can also run its `consult` mode
manually to check the certificate, connection and response parser without submitting a record. The
workflow never uses a production or seal-certificate endpoint. It does not call `RequerimientoSOAP`,
which belongs to non-VERI*FACTU submissions made in response to an AEAT requirement.

Create the `aeat-preproduction` GitHub environment and add these environment secrets:

| Secret                     | Value                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| `AEAT_TEST_P12_BASE64`     | Base64 encoding of the authorized certificate's `.p12`/`.pfx` bytes |
| `AEAT_TEST_P12_PASSWORD`   | Password for that certificate                                       |
| `AEAT_TEST_NIF`            | Test issuer NIF accepted by AEAT for that certificate               |
| `AEAT_TEST_NAME`           | Test issuer's registered name                                       |
| `AEAT_TEST_SYSTEM_NIF`     | NIF of the software producer represented in `SistemaInformatico`    |
| `AEAT_TEST_SYSTEM_NAME`    | Registered name of that software producer                           |
| `AEAT_TEST_RECIPIENT_NIF`  | Spanish NIF of the test invoice recipient                           |
| `AEAT_TEST_RECIPIENT_NAME` | Registered name matching `AEAT_TEST_RECIPIENT_NIF`                  |

When configuring another repository or environment, set the repository variable
`AEAT_TEST_CERT_KIND` to `personal` or `sello` (defaults to
`personal`). Run `consult` manually to check authentication and response parsing, then run `submit`
manually to check the full alta, consulta and anulación sequence. Once both pass, set the repository
variable `AEAT_LIVE_TESTS_ENABLED` to `true` for the monthly job. Manual runs on `main` work while
that variable is unset. Limit the GitHub environment to the `main` branch.
The certificate must be authorised for the test issuer in AEAT's preproduction service. Base64
is only an encoding, so keep the value in a GitHub secret, never in this repository.

AEAT says its preproduction service is for occasional integration tests and rules out bulk
testing. This workflow makes ten requests per monthly run and obeys the wait returned before its
second submission. It tests the pagination request with a known cursor instead of creating the
10,001 records needed to force a second response page. If AEAT changes its conditions or the
certificate expires, pause the live workflow and update the test setup.
