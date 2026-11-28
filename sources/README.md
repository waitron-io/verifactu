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

## Compare source revisions

Fingerprints tell you that something changed; the copies in `archive/` let you inspect it.
`--refresh` saves the normalized HTML text that was hashed, the original PDF and schema bytes,
and each watched GitHub commit's gzip-compressed metadata and repository tarball. `watch-baseline.json` names
those files, their URLs and their SHA-256 checksums. Repository tarballs name the observed commit,
so a later branch update cannot silently replace the requested revision.

The files are addressed by content hash. Refreshing adds new versions and retains older files.
It publishes a replacement baseline only after every download and archive write succeeds.
An interrupted refresh can leave extra archive files; it does not publish a half-written baseline.
The archive is excluded from formatting because reformatting source copies would change their
checksums. Read-only checks neither refresh the baseline nor write archive files. Change reports
name the previous source copy for comparison.

The initial [seed manifest](archive/seed-2026-10-27.json) records all 43 sources downloaded on
27 October 2026 and the 20 September Wayback copy of the FAQ index. It does not contain the lost
September bodies of the 18 linked FAQ pages. The [October FAQ review](reviews/2026-10-27-faq.md)
records what could be recovered and the limits of the current-rule audit.

## AEAT's certificate chain

Until 2026-11-17 the script fetched the three PDFs on `www.agenciatributaria.es` with curl and a
bundled copy of FNMT's SHA-1-signed "AC Componentes Informáticos" intermediate (see
[#134](https://github.com/waitron-io/verifactu/pull/134)). Checked on 2026-11-17: the site
serves a certificate issued on 12 November 2026 under the root "AC RAIZ FNMT-RCM SERVIDORES
SEGUROS", and a read-only check with Node's `fetch` downloaded all three PDFs and matched their
pinned fingerprints on macOS (Node 26.13.0) and in an `ubuntu:24.04` container (Node 22.23.5), so
the script now fetches every source with `fetch`. If those PDFs start failing with a certificate
error, inspect the chain with
`openssl s_client -connect www.agenciatributaria.es:443 -servername www.agenciatributaria.es -showcerts`.

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

| Secret                     | Value                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `AEAT_TEST_P12_BASE64`     | Base64 encoding of the authorized certificate's `.p12`/`.pfx` bytes                |
| `AEAT_TEST_P12_PASSWORD`   | Password for that certificate                                                      |
| `AEAT_TEST_NIF`            | Test issuer NIF accepted by AEAT for that certificate                              |
| `AEAT_TEST_NAME`           | Test issuer's registered name                                                      |
| `AEAT_TEST_SYSTEM_NIF`     | NIF of the software producer represented in `SistemaInformatico`, and customer B's |
| `AEAT_TEST_SYSTEM_NAME`    | Registered name of that software producer, and customer B's                        |
| `AEAT_TEST_RECIPIENT_NIF`  | Spanish NIF of the test invoice recipient                                          |
| `AEAT_TEST_RECIPIENT_NAME` | Registered name matching `AEAT_TEST_RECIPIENT_NIF`                                 |

The `full-invoice-changes` mode sends the producer as customer B in case B5. A run of all its cases
is refused before anything is sent if `AEAT_TEST_SYSTEM_NIF` matches `AEAT_TEST_NIF` or
`AEAT_TEST_RECIPIENT_NIF`, or if `AEAT_TEST_RECIPIENT_NAME` is already "Renamed Customer SL" (in
any capitalisation or spacing), the name cases B1, B3 and B4 give customer A.

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
