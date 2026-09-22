import { DOMParser, Node, type Element } from "@xmldom/xmldom";
import { expect } from "vitest";

const NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/";
const NS_XMLNS = "http://www.w3.org/2000/xmlns/";

// Compare expanded names and ordered content; prefixes, entity spelling, and layout are incidental.
export interface XmlNode {
  name: string;
  attributes: Array<[string, string]>;
  children: Array<XmlNode | string>;
}

export function parseXml(xml: string): Element {
  const document = new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (root === null) throw new Error("XML document has no root element");
  return root;
}

export function xmlNode(element: Element): XmlNode {
  const attributes: Array<[string, string]> = Array.from(element.attributes)
    .filter((attribute) => attribute.namespaceURI !== NS_XMLNS)
    .map((attribute) => [
      `{${attribute.namespaceURI ?? ""}}${attribute.localName}`,
      attribute.value,
    ]);
  attributes.sort(([left], [right]) => left.localeCompare(right));

  const children: Array<XmlNode | string> = [];
  const hasElementChildren = Array.from(element.childNodes).some(
    (child) => child.nodeType === Node.ELEMENT_NODE,
  );
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      children.push(xmlNode(child as Element));
    } else if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      const value = child.nodeValue;
      if (value !== null && (!hasElementChildren || value.trim())) children.push(value);
    }
  }
  return {
    name: `{${element.namespaceURI ?? ""}}${element.localName}`,
    attributes,
    children,
  };
}

export function soapPayload(xml: string): XmlNode {
  const envelope = parseXml(xml);
  expect(envelope.namespaceURI).toBe(NS_SOAP);
  expect(envelope.localName).toBe("Envelope");
  const body = Array.from(envelope.childNodes).find(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      node.namespaceURI === NS_SOAP &&
      node.localName === "Body",
  ) as Element | undefined;
  expect(body).toBeDefined();
  const payloads = Array.from(body!.childNodes).filter(
    (node): node is Element => node.nodeType === Node.ELEMENT_NODE,
  );
  expect(payloads).toHaveLength(1);
  return xmlNode(payloads[0]!);
}
