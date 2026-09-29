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
      description: "Build, check and send Veri*Factu invoice records from TypeScript.",
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
            { ...t("Overview", "Introducción"), slug: "" },
            { ...t("Getting started", "Primeros pasos"), slug: "getting-started" },
          ],
        },
        {
          ...t("Guides", "Guías"),
          items: [
            { ...t("Invoice records", "Registros de facturación"), slug: "guides/records" },
            { ...t("Linking records", "Encadenar registros"), slug: "guides/chain" },
            { ...t("Checking records", "Comprobar registros"), slug: "guides/checking" },
            { ...t("Sending to AEAT", "Enviar a la AEAT"), slug: "guides/sending" },
            { ...t("AEAT's reply", "La respuesta de la AEAT"), slug: "guides/replies" },
            { ...t("Reliable delivery", "Envío fiable"), slug: "guides/delivery" },
            { ...t("Looking up records", "Consultar registros"), slug: "guides/lookup" },
            { ...t("QR codes", "Códigos QR"), slug: "guides/qr" },
            { ...t("Testing", "Pruebas"), slug: "guides/testing" },
          ],
        },
        {
          ...t("More", "Más"),
          items: [
            {
              ...t("Taxes and special schemes", "Impuestos y regímenes especiales"),
              slug: "guides/tax",
            },
            { ...t("Lower-level tools", "Herramientas de bajo nivel"), slug: "guides/tools" },
            {
              ...t("Your invoicing system (SIF)", "Tu sistema de facturación (SIF)"),
              slug: "guides/sif",
            },
            {
              ...t("What your application does", "Lo que hace tu aplicación"),
              slug: "guides/your-application",
            },
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
