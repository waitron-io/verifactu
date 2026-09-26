import { QR_ENDPOINTS, type Environment } from "./endpoints.js";
import type { RegistroAlta } from "./types.js";

/**
 * Percent-encodes a parameter value.
 *
 * AEAT's reference uses Java's URLEncoder (form-urlencoding, space -> "+"),
 * while encodeURIComponent follows RFC 3986 (space -> "%20"). The spec does
 * not settle which applies. This function is shared by all four QR
 * parameters, and the four differ in how (or whether) that ambiguity is
 * actually foreclosed:
 *  - numserie: a built and validated record uses a charset with no character
 *    where the two encodings differ. This helper still encodes direct record
 *    literals, including AEAT's published ampersand example.
 *  - fecha, importe: unreachable by construction — formatDate/formatAmountExact
 *    are the only producers of these literals and never emit a space or any
 *    other character where the two encodings differ, independent of
 *    whether validate() runs.
 *  - nif (IDEmisorFactura): validate() checks the Spanish identifier shape
 *    and control character. Call it before building a QR; buildQrPayload
 *    itself accepts any record, including one that was never validated.
 */
function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Builds the QR payload URL: exactly four mandatory parameters, in order.
 *
 * Values are taken from the record's own literals, never recomputed, so the
 * QR URL refers to the same invoice values supplied for filing.
 */
export function buildQrPayload(record: RegistroAlta, environment: Environment): string {
  const params = [
    ["nif", record.IDFactura.IDEmisorFactura],
    ["numserie", record.IDFactura.NumSerieFactura],
    ["fecha", record.IDFactura.FechaExpedicionFactura],
    ["importe", record.ImporteTotal],
  ] as const;
  const query = params.map(([name, value]) => `${name}=${encodeParam(value)}`).join("&");
  return `${QR_ENDPOINTS[environment]}?${query}`;
}
