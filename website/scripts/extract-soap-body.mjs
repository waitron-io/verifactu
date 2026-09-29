import { readFileSync } from "node:fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const path = process.argv[2];
if (!path)
  throw new Error("Usage: node website/scripts/extract-soap-body.mjs request-envelope.xml");
const document = new DOMParser().parseFromString(readFileSync(path, "utf8"), "text/xml");
if (document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature").length) {
  throw new Error("The unsigned-only example cannot validate XML signatures");
}
const body = document
  .getElementsByTagNameNS("http://schemas.xmlsoap.org/soap/envelope/", "Body")
  .item(0);
const request = Array.from(body?.childNodes ?? []).find((node) => node.nodeType === 1);
if (!request) throw new Error("SOAP Body has no request element");
process.stdout.write(new XMLSerializer().serializeToString(request));
