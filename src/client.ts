import { parseRespuestaConsulta, type RespuestaConsulta } from "./xml/parse-consulta.js";
import { parseRespuestaSuministro, type RespuestaSuministro } from "./xml/parse-suministro.js";
import { parser } from "./xml/parse-common.js";
import {
  serializeConsulta,
  serializeEnvio,
  type Cabecera,
  type CabeceraConsulta,
  type ConsultaFiltro,
  type EnvioRegistro,
} from "./xml/serialize.js";

export interface ClientOptions {
  endpoint: string;
  /**
   * Injected so the library is runtime-agnostic and testable without a
   * network. Client-certificate material is supplied by the caller's fetch
   * implementation — in Node that means an Agent/Dispatcher configured with
   * the cert and key. Keeping mTLS configuration outside this library is
   * deliberate: certificate handling is a deployment concern, and the spec
   * requires the submitter to be an interface rather than a location.
   */
  fetch: typeof globalThis.fetch;
}

export interface VerifactuClient {
  submit(cabecera: Cabecera, registros: EnvioRegistro[]): Promise<RespuestaSuministro>;
  consultar(cabecera: CabeceraConsulta, filtro: ConsultaFiltro): Promise<RespuestaConsulta>;
}

const SOAP_FAULT_TAG = /<(?:[\w.-]+:)?Fault(?:\s|\/?>)/;

function soapText(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!value || typeof value !== "object") return undefined;
  const nested = value as Record<string, unknown>;
  return soapText(nested.Text) ?? soapText(nested.Value);
}

function soapFaultMessage(text: string, status: number): string | undefined {
  // Successful consulta pages can contain 10 000 records. Avoid building a
  // second full object tree unless the wire text contains an actual Fault tag.
  if (!SOAP_FAULT_TAG.test(text)) return undefined;
  const body = (parser.parse(text) as { Envelope?: { Body?: Record<string, unknown> } }).Envelope
    ?.Body;
  if (!body || !Object.prototype.hasOwnProperty.call(body, "Fault")) return undefined;

  const fault = body.Fault;
  const fields = fault && typeof fault === "object" ? (fault as Record<string, unknown>) : {};
  const code = soapText(fields.faultcode) ?? soapText(fields.Code);
  const reason = soapText(fields.faultstring) ?? soapText(fields.Reason);
  if (!code && !reason) return `AEAT SOAP fault (HTTP ${status}): ${text.slice(0, 500)}`;
  return `AEAT SOAP fault (HTTP ${status})${code ? ` ${code}` : ""}${reason ? `: ${reason}` : ""}`;
}

async function post(options: ClientOptions, xml: string): Promise<string> {
  const response = await options.fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      // The WSDL declares soapAction="" on every operation; dispatch is by
      // message body, not by this header.
      SOAPAction: '""',
    },
    body: xml,
  });
  const text = await response.text();
  const fault = soapFaultMessage(text, response.status);
  if (fault) throw new Error(fault);
  if (!response.ok) {
    throw new Error(`AEAT request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

export function createClient(options: ClientOptions): VerifactuClient {
  return {
    async submit(cabecera, registros) {
      return parseRespuestaSuministro(await post(options, serializeEnvio(cabecera, registros)));
    },
    async consultar(cabecera, filtro) {
      return parseRespuestaConsulta(await post(options, serializeConsulta(cabecera, filtro)));
    },
  };
}
