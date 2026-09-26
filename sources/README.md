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
node scripts/source-watch.mjs --refresh
node scripts/source-watch.mjs
```

Commit the new baseline with the change it represents. HTML fingerprints include the page's
main text and links, so navigation or footer changes should not cause an alert. PDF and schema
fingerprints cover the downloaded bytes. A new FAQ page changes the index fingerprint; add
the new page to `scripts/source-watch.mjs` before refreshing the baseline.

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
