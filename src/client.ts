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

/** The failure stage, not a retry policy or proof that a submitted record was rejected. */
export type TransportErrorKind = "network" | "http" | "soap";

/**
 * A request or response-body failure. Response parser and serializer failures
 * remain separate errors. No request options, headers or certificate data are
 * attached. The caller's original cause and server diagnostics may themselves
 * contain sensitive data; choose what to log rather than dumping the error.
 */
export class VerifactuTransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly status: number | undefined;
  readonly faultCode: string | undefined;
  readonly faultReason: string | undefined;
  readonly bodyExcerpt: string | undefined;

  constructor(
    message: string,
    details: {
      kind: TransportErrorKind;
      status?: number;
      faultCode?: string;
      faultReason?: string;
      bodyExcerpt?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = "VerifactuTransportError";
    this.kind = details.kind;
    this.status = details.status;
    this.faultCode = details.faultCode;
    this.faultReason = details.faultReason;
    this.bodyExcerpt = details.bodyExcerpt;
  }
}

const SOAP_FAULT_TAG = /<(?:[\w.-]+:)?Fault(?:\s|\/?>)/;

function bodyExcerpt(text: string): string {
  const excerpt = text.slice(0, 500);
  const last = excerpt.charCodeAt(excerpt.length - 1);
  // A high surrogate at the limit needs its following code unit to form one character.
  return last >= 0xd800 && last <= 0xdbff ? excerpt.slice(0, -1) : excerpt;
}

function soapText(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!value || typeof value !== "object") return undefined;
  const nested = value as Record<string, unknown>;
  return soapText(nested.Text) ?? soapText(nested.Value);
}

function soapFault(text: string, status: number): VerifactuTransportError | undefined {
  // Successful consulta pages can contain 10 000 records. Avoid building a
  // second full object tree unless the wire text contains an actual Fault tag.
  if (!SOAP_FAULT_TAG.test(text)) return undefined;
  const excerpt = bodyExcerpt(text);
  let body: Record<string, unknown> | undefined;
  try {
    body = (parser.parse(text) as { Envelope?: { Body?: Record<string, unknown> } }).Envelope?.Body;
  } catch (cause) {
    // A malformed fault must retain the HTTP context and its parse diagnostic.
    return new VerifactuTransportError(`AEAT SOAP fault (HTTP ${status}): ${excerpt}`, {
      kind: "soap",
      status,
      bodyExcerpt: excerpt,
      cause,
    });
  }
  if (!body || !Object.prototype.hasOwnProperty.call(body, "Fault")) return undefined;

  const fault = body.Fault;
  const fields = fault && typeof fault === "object" ? (fault as Record<string, unknown>) : {};
  const faultCode = soapText(fields.faultcode) ?? soapText(fields.Code);
  const faultReason = soapText(fields.faultstring) ?? soapText(fields.Reason);
  const message =
    !faultCode && !faultReason
      ? `AEAT SOAP fault (HTTP ${status}): ${excerpt}`
      : `AEAT SOAP fault (HTTP ${status})${faultCode ? ` ${faultCode}` : ""}${faultReason ? `: ${faultReason}` : ""}`;
  return new VerifactuTransportError(message, {
    kind: "soap",
    status,
    faultCode,
    faultReason,
    bodyExcerpt: excerpt,
  });
}

async function post(options: ClientOptions, xml: string): Promise<string> {
  let response: Response | undefined;
  let text: string;
  try {
    response = await options.fetch(options.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        // The WSDL declares soapAction="" on every operation; dispatch is by
        // message body, not by this header.
        SOAPAction: '""',
      },
      body: xml,
    });
    text = await response.text();
  } catch (cause) {
    throw new VerifactuTransportError(
      cause instanceof Error && cause.message ? cause.message : "AEAT network request failed",
      { kind: "network", status: response?.status, cause },
    );
  }
  const fault = soapFault(text, response.status);
  if (fault) throw fault;
  if (!response.ok) {
    const excerpt = bodyExcerpt(text);
    throw new VerifactuTransportError(
      `AEAT request failed with HTTP ${response.status}: ${excerpt}`,
      { kind: "http", status: response.status, bodyExcerpt: excerpt },
    );
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
