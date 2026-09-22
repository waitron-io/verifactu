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

When you change an example in the submission, QR, or testing guides, run `npm run verify:docs`.
It compiles and runs the published English and Spanish code blocks, including the documented
output values and QR image round trip. `verify:examples` also checks the record chain,
fake-AEAT submission, consulta, cancellation, and certificate-fetch adapter.
