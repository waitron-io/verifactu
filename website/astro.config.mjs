// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc from "starlight-typedoc";

// Project GitHub Pages: https://waitron-io.github.io/verifactu/
// Override `site`/`base` here (or via a CNAME) if a custom domain is set up later.
const site = "https://waitron-io.github.io";
const base = "/verifactu";

// Sidebar group labels, translated so the navigation reads in both locales.
const t = (en, es) => ({ label: en, translations: { es } });

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: "@waitron/verifactu",
      description:
        "A TypeScript library for Spain's Veri*Factu invoicing records: huella hash chaining, QR payloads, XML, and AEAT submission.",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/waitron-io/verifactu" },
      ],
      defaultLocale: "en",
      locales: {
        en: { label: "English", lang: "en" },
        es: { label: "Español", lang: "es" },
      },
      plugins: [
        // Generates the API reference from the library's TSDoc comments. The reference is
        // English in both locales (it comes from the code's English identifiers); the guides
        // are what get translated.
        starlightTypeDoc({
          entryPoints: ["../src/index.ts", "../src/facade.ts", "../src/testing/fake-aeat.ts"],
          tsconfig: "../tsconfig.json",
          output: "api",
          sidebar: { label: "API reference", collapsed: true },
          typeDoc: {
            entryPointStrategy: "resolve",
            excludeInternal: true,
            readme: "./api-intro.md",
            skipErrorChecking: true,
          },
        }),
      ],
      sidebar: [
        {
          ...t("Start here", "Empieza aquí"),
          items: [
            { ...t("Introduction", "Introducción"), slug: "start/introduction" },
            { ...t("Getting started", "Primeros pasos"), slug: "start/getting-started" },
            { ...t("Is this a SIF?", "¿Esto es un SIF?"), slug: "start/not-a-sif" },
          ],
        },
        {
          ...t("Guides", "Guías"),
          items: [
            { ...t("Build an alta record", "Crear un registro de alta"), slug: "guides/alta-record" },
            { ...t("Build and submit with fewer steps", "Crear y enviar con menos pasos"), slug: "guides/facade" },
            { ...t("The huella hash chain", "La cadena de huellas"), slug: "guides/huella-chain" },
            { ...t("Validation", "Validación"), slug: "guides/validation" },
            { ...t("QR payloads and images", "Códigos QR"), slug: "guides/qr" },
            { ...t("Submit and query AEAT", "Enviar y consultar a la AEAT"), slug: "guides/submit" },
            { ...t("Query AEAT", "Consultar a la AEAT"), slug: "guides/consulta" },
            { ...t("Testing with a fake AEAT", "Pruebas con una AEAT falsa"), slug: "guides/testing" },
          ],
        },
        {
          ...t("API reference", "Referencia de la API"),
          items: [
            // Starlight prefixes manual links with the active locale; one `..` reaches the
            // shared English reference outside both locale trees.
            { ...t("Overview", "Índice"), link: "../api/readme/" },
            { ...t("Public API", "API pública"), link: "../api/index/readme/" },
            { ...t("Facade API", "API de la fachada"), link: "../api/facade/readme/" },
            { ...t("Testing API", "API de pruebas"), link: "../api/testing/fake-aeat/readme/" },
          ],
        },
      ],
    }),
  ],
});
