import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import {
  SOAP_ENDPOINTS,
  SOAP_ENDPOINTS_REQUERIMIENTO,
  SOAP_ENDPOINTS_REQUERIMIENTO_SELLO,
  SOAP_ENDPOINTS_SELLO,
} from "./endpoints.js";

const SCHEMA_DIR = fileURLToPath(new URL("../schemas/", import.meta.url));
const WSDL_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SistemaFacturacion.wsdl";
const SF_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
const LR_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd";
const CONSULTA_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd";
const RESPUESTA_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd";
const RESPUESTA_CONSULTA_NS =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd";
const XML_SIGNATURE_NS = "http://www.w3.org/2000/09/xmldsig#";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: false,
  isArray: (name, _path, _isLeaf, isAttribute) =>
    !isAttribute &&
    new Set([
      "xs:import",
      "wsdl:message",
      "wsdl:part",
      "wsdl:portType",
      "wsdl:operation",
      "wsdl:input",
      "wsdl:output",
      "wsdl:binding",
      "wsdl:service",
      "wsdl:port",
      "import",
      "element",
    ]).has(name),
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an XML element`);
  }
  return value as Record<string, unknown>;
}

function children(parent: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const value = parent[name];
  if (!Array.isArray(value)) throw new Error(`${name} is not an XML element array`);
  return value.map((child, index) => record(child, `${name}[${index}]`));
}

function attribute(element: Record<string, unknown>, name: string): string {
  const value = element[name];
  if (typeof value !== "string") throw new Error(`${name} is not an XML attribute`);
  return value;
}

const schemaContract = {
  "SuministroInformacion.xsd": {
    namespace: SF_NS,
    imports: [[XML_SIGNATURE_NS, "http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd"]],
    elements: ["RegistroAlta", "RegistroAnulacion"],
  },
  "SuministroLR.xsd": {
    namespace: LR_NS,
    imports: [[SF_NS, "SuministroInformacion.xsd"]],
    elements: ["RegFactuSistemaFacturacion"],
  },
  "ConsultaLR.xsd": {
    namespace: CONSULTA_NS,
    imports: [[SF_NS, "SuministroInformacion.xsd"]],
    elements: ["ConsultaFactuSistemaFacturacion"],
  },
  "RespuestaSuministro.xsd": {
    namespace: RESPUESTA_NS,
    imports: [
      [SF_NS, "SuministroInformacion.xsd"],
      [LR_NS, "SuministroLR.xsd"],
    ],
    elements: ["RespuestaRegFactuSistemaFacturacion"],
  },
  "RespuestaConsultaLR.xsd": {
    namespace: RESPUESTA_CONSULTA_NS,
    imports: [[SF_NS, "SuministroInformacion.xsd"]],
    elements: ["RespuestaConsultaFactuSistemaFacturacion"],
  },
} as const;

const wsdl = record(
  record(parser.parse(readFileSync(SCHEMA_DIR + "SistemaFacturacion.wsdl", "utf8")), "WSDL")[
    "wsdl:definitions"
  ],
  "wsdl:definitions",
);

describe("AEAT WSDL and cross-schema contract", () => {
  it("keeps every local schema import on the pinned namespace and filename", () => {
    for (const [file, expected] of Object.entries(schemaContract)) {
      const schema = record(
        record(parser.parse(readFileSync(SCHEMA_DIR + file, "utf8")), file).schema,
        `${file} schema`,
      );
      expect(attribute(schema, "targetNamespace"), file).toBe(expected.namespace);
      expect(
        children(schema, "import").map((entry) => [
          attribute(entry, "namespace"),
          attribute(entry, "schemaLocation"),
        ]),
        file,
      ).toEqual(expected.imports);
      expect(
        children(schema, "element").map((entry) => attribute(entry, "name")),
        file,
      ).toEqual(expected.elements);
    }
  });

  it("links all five schemas and all four document messages to existing global elements", () => {
    const types = record(wsdl["wsdl:types"], "wsdl:types");
    const schema = record(types["xs:schema"], "wsdl:types/xs:schema");
    expect(attribute(wsdl, "targetNamespace")).toBe(WSDL_NS);
    expect(
      children(schema, "xs:import").map((entry) => [
        attribute(entry, "namespace"),
        attribute(entry, "schemaLocation"),
      ]),
    ).toEqual([
      [SF_NS, "SuministroInformacion.xsd"],
      [LR_NS, "SuministroLR.xsd"],
      [CONSULTA_NS, "ConsultaLR.xsd"],
      [RESPUESTA_CONSULTA_NS, "RespuestaConsultaLR.xsd"],
      [RESPUESTA_NS, "RespuestaSuministro.xsd"],
    ]);

    expect(
      children(wsdl, "wsdl:message").map((message) => {
        const [part] = children(message, "wsdl:part");
        return [attribute(message, "name"), attribute(part!, "name"), attribute(part!, "element")];
      }),
    ).toEqual([
      [
        "EntradaRegFactuSistemaFacturacion",
        "RegFactuSistemaFacturacion",
        "sfLR:RegFactuSistemaFacturacion",
      ],
      [
        "EntradaConsultaFactuSistemaFacturacion",
        "ConsultaFactuSistemaFacturacion",
        "sfLRC:ConsultaFactuSistemaFacturacion",
      ],
      [
        "RespuestaRegFactuSistemaFacturacion",
        "RespuestaRegFactuSistemaFacturacion",
        "sfR:RespuestaRegFactuSistemaFacturacion",
      ],
      [
        "RespuestaConsultaFactuSistemaFacturacion",
        "RespuestaConsultaFactuSistemaFacturacion",
        "sfLRRC:RespuestaConsultaFactuSistemaFacturacion",
      ],
    ]);

    const elementsByNamespace = new Map<string, readonly string[]>(
      Object.values(schemaContract).map(
        (contract) => [contract.namespace, contract.elements] as const,
      ),
    );
    for (const message of children(wsdl, "wsdl:message")) {
      const [part] = children(message, "wsdl:part");
      const qualifiedElement = attribute(part!, "element");
      const [prefix, localName] = qualifiedElement.split(":");
      const namespace = attribute(wsdl, `xmlns:${prefix}`);
      expect(elementsByNamespace.get(namespace), qualifiedElement).toContain(localName);
    }
  });

  it("keeps the voluntary and under-requirement operation graphs distinct", () => {
    expect(
      children(wsdl, "wsdl:portType").map((portType) => [
        attribute(portType, "name"),
        children(portType, "wsdl:operation").map((operation) => [
          attribute(operation, "name"),
          attribute(children(operation, "wsdl:input")[0]!, "message"),
          attribute(children(operation, "wsdl:output")[0]!, "message"),
        ]),
      ]),
    ).toEqual([
      [
        "sfPortTypeVerifactu",
        [
          [
            "RegFactuSistemaFacturacion",
            "sfWdsl:EntradaRegFactuSistemaFacturacion",
            "sfWdsl:RespuestaRegFactuSistemaFacturacion",
          ],
          [
            "ConsultaFactuSistemaFacturacion",
            "sfWdsl:EntradaConsultaFactuSistemaFacturacion",
            "sfWdsl:RespuestaConsultaFactuSistemaFacturacion",
          ],
        ],
      ],
      [
        "sfPortTypePorRequerimiento",
        [
          [
            "RegFactuSistemaFacturacion",
            "sfWdsl:EntradaRegFactuSistemaFacturacion",
            "sfWdsl:RespuestaRegFactuSistemaFacturacion",
          ],
        ],
      ],
    ]);
  });

  it("pins both bindings to SOAP 1.1 document/literal with an empty action", () => {
    expect(
      children(wsdl, "wsdl:binding").map((binding) => {
        const soapBinding = record(binding["soap:binding"], "soap:binding");
        return [
          attribute(binding, "name"),
          attribute(binding, "type"),
          attribute(soapBinding, "style"),
          attribute(soapBinding, "transport"),
          children(binding, "wsdl:operation").map((operation) => [
            attribute(operation, "name"),
            attribute(record(operation["soap:operation"], "soap:operation"), "soapAction"),
            attribute(
              record(children(operation, "wsdl:input")[0]!["soap:body"], "input soap:body"),
              "use",
            ),
            attribute(
              record(children(operation, "wsdl:output")[0]!["soap:body"], "output soap:body"),
              "use",
            ),
          ]),
        ];
      }),
    ).toEqual([
      [
        "sfVerifactu",
        "sfWdsl:sfPortTypeVerifactu",
        "document",
        "http://schemas.xmlsoap.org/soap/http",
        [
          ["RegFactuSistemaFacturacion", "", "literal", "literal"],
          ["ConsultaFactuSistemaFacturacion", "", "literal", "literal"],
        ],
      ],
      [
        "sfRequerimiento",
        "sfWdsl:sfPortTypePorRequerimiento",
        "document",
        "http://schemas.xmlsoap.org/soap/http",
        [["RegFactuSistemaFacturacion", "", "literal", "literal"]],
      ],
    ]);
  });

  it("keeps all eight WSDL ports aligned with the exported client endpoints", () => {
    expect(
      children(wsdl, "wsdl:service").map((service) => [
        attribute(service, "name"),
        children(service, "wsdl:port").map((port) => [
          attribute(port, "name"),
          attribute(port, "binding"),
          attribute(record(port["soap:address"], "soap:address"), "location"),
        ]),
      ]),
    ).toEqual([
      [
        "sfVerifactu",
        [
          ["SistemaVerifactu", "sfWdsl:sfVerifactu", SOAP_ENDPOINTS.production],
          ["SistemaVerifactuSello", "sfWdsl:sfVerifactu", SOAP_ENDPOINTS_SELLO.production],
          ["SistemaVerifactuPruebas", "sfWdsl:sfVerifactu", SOAP_ENDPOINTS.preproduction],
          [
            "SistemaVerifactuSelloPruebas",
            "sfWdsl:sfVerifactu",
            SOAP_ENDPOINTS_SELLO.preproduction,
          ],
        ],
      ],
      [
        "sfRequerimiento",
        [
          [
            "SistemaRequerimiento",
            "sfWdsl:sfRequerimiento",
            SOAP_ENDPOINTS_REQUERIMIENTO.production,
          ],
          [
            "SistemaRequerimientoSello",
            "sfWdsl:sfRequerimiento",
            SOAP_ENDPOINTS_REQUERIMIENTO_SELLO.production,
          ],
          [
            "SistemaRequerimientoPruebas",
            "sfWdsl:sfRequerimiento",
            SOAP_ENDPOINTS_REQUERIMIENTO.preproduction,
          ],
          [
            "SistemaRequerimientoSelloPruebas",
            "sfWdsl:sfRequerimiento",
            SOAP_ENDPOINTS_REQUERIMIENTO_SELLO.preproduction,
          ],
        ],
      ],
    ]);
  });
});
