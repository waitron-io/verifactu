# Documentation site

This site explains how you build, validate, submit, and query Veri*Factu records with
`@waitron/verifactu`. It uses Astro Starlight. The English and Spanish guides live in
`src/content/docs/en/` and `src/content/docs/es/`. The API reference is generated from the
library's TypeScript comments during the build.

From the repository root, build the library first. The runnable example check imports its
compiled files:

```sh
npm ci
npm run build
cd website
npm ci
npm run verify:examples
npm run verify:docs
npm run verify:types
npm run build
npm run verify:links
npm run preview
```

Open the preview at `/verifactu/`; the root page sends you to the English homepage. Select
Español in the language menu for the full Spanish translation. The generated API reference uses
English descriptions in both languages.

When you change a TypeScript example in either language, run `npm run verify:docs`. It finds every
TypeScript block on every English and Spanish page, whether the fence says `ts` or `typescript`
and whether or not it carries a title. It joins each page's blocks, compiles them with TypeScript's
strict checks, and runs them against the offline AEAT from the library's testing module. Where a
page leaves something for you to write, such as saving a reply, the checker supplies a stand-in.
It also calls the adapters that a page defines but never calls itself (the certificate `fetch` and
the `fetch` that keeps AEAT's raw XML) through the offline AEAT.

A `console.log(...); // output` line must run exactly once and print the text in its own comment.
Any other `console.log` must print nothing. The check fails when a page has TypeScript blocks but
is missing from the checker's list of pages, and when it meets a code fence in a language it does
not know, so an example can't be skipped without anyone noticing. It also runs the first two
TypeScript examples in the repository's README.

`npm run verify:examples` runs two scripts against the offline AEAT. The first builds a chain of
records and checks submission, a duplicate resend, a lookup, a cancellation, the certificate
`fetch`, and a QR image round trip. It then saves a request envelope made by the library and runs
`scripts/extract-soap-body.mjs` on it, the way the tools guide does, to confirm that the output is
the request itself and that a signed envelope is refused. The second script runs a delivery worker
with an outbox. It checks that a failed transaction saves nothing, that a job interrupted while
sending becomes `unknown`, that AEAT's wait is respected, and that an `unknown` job is sent again
unchanged, holding later jobs back, until a reply arrives. It covers both ways a reply gets lost:
AEAT stored the record, so the resend comes back as a duplicate, or the request never arrived, so
the resend is accepted.
