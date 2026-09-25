import { asArray, asNumber, parser } from "./parse-common.js";
import {
  assertConsultaNif,
  isValidConsultaFecha,
  isValidConsultaNumSerieFactura,
} from "./serialize.js";
import type { IDFactura } from "../types.js";

/**
 * The consulta enum. Deliberately NOT shared with the submission response's
 * EstadoRegistroSuministro ("Correcto" / "AceptadoConErrores" / "Incorrecto"):
 *
 *   - No `Incorrecto`, because a rejected record is never stored — AEAT never
 *     holds a record it refused, so a query can never come back reporting one.
 *   - Has `Anulado`, which submission never returns.
 *
 * A shared type would model states that cannot occur on one side and miss
 * states that can occur on the other.
 */
export type EstadoRegistroConsulta = "Correcto" | "AceptadoConErrores" | "Anulado";

function estadoRegistroConsultaOf(value: string): EstadoRegistroConsulta {
  switch (value) {
    case "Correcto":
    case "AceptadoConErrores":
    case "Anulado":
      return value;
    default:
      throw new Error(`Unexpected consulta record state: ${value}`);
  }
}

export interface DatosPresentacionConsulta {
  NIFPresentador?: string;
  TimestampPresentacion?: string;
  IdPeticion?: string;
}

export interface RegistroConsultado {
  IDFactura: IDFactura;
  /**
   * The full stored record as AEAT holds it, including its huella. Comparing
   * this huella against one computed locally is a single-field check
   * equivalent to diffing every hashed field, which is how a
   * duplicate-record ambiguity (error 3000 with no RegistroDuplicado detail)
   * gets resolved. There is deliberately no `csv` field here: the CSV exists
   * only in the submission response and can never be retrieved by a query.
   */
  DatosRegistroFacturacion: Record<string, unknown> & { Huella?: string; TipoHuella?: string };
  /**
   * When AEAT's stored copy of this record was last modified. Required by the
   * schema (EstadoRegFactuType), unlike everything else nested inside
   * EstadoRegistro — it's what lets a consumer reconcile its own records
   * against the authority's without re-querying everything.
   */
  TimestampUltimaModificacion: string;
  EstadoRegistro: EstadoRegistroConsulta;
  CodigoErrorRegistro?: number;
  DescripcionErrorRegistro?: string;
  DatosPresentacion?: DatosPresentacionConsulta;
}

export interface RespuestaConsulta {
  ResultadoConsulta: "ConDatos" | "SinDatos";
  IndicadorPaginacion: "S" | "N";
  /**
   * Present only when IndicadorPaginacion is "S". Echo this verbatim into the
   * next request to continue a paged sweep — results are capped at 10 000
   * records per page and ordered by presentation date, not invoice date.
   */
  ClavePaginacion?: IDFactura;
  registros: RegistroConsultado[];
}

// The raw shape fast-xml-parser hands back. Leaf values stay strings —
// parseTagValue is off — so CodigoErrorRegistro needs explicit numeric
// conversion below. EstadoRegistro is nested: the response wraps a leaf
// EstadoRegistro (plus the error fields) inside an outer EstadoRegistro
// element of the same name.

interface RawEstadoRegistro {
  TimestampUltimaModificacion: string;
  EstadoRegistro: string;
  CodigoErrorRegistro?: string;
  DescripcionErrorRegistro?: string;
}

interface RawDatosPresentacion {
  NIFPresentador?: string;
  TimestampPresentacion?: string;
  IdPeticion?: string;
}

interface RawRegistroConsultado {
  IDFactura: unknown;
  DatosRegistroFacturacion: unknown;
  EstadoRegistro: RawEstadoRegistro | undefined;
  DatosPresentacion?: RawDatosPresentacion;
}

interface RawRespuestaConsulta {
  ResultadoConsulta: unknown;
  IndicadorPaginacion: unknown;
  ClavePaginacion?: unknown;
  RegistroRespuestaConsultaFactuSistemaFacturacion?:
    RawRegistroConsultado | RawRegistroConsultado[];
}

interface RawEnvelope {
  Envelope?: {
    Body?: {
      RespuestaConsultaFactuSistemaFacturacion?: RawRespuestaConsulta;
    };
  };
}

function resultadoConsultaOf(value: unknown): RespuestaConsulta["ResultadoConsulta"] {
  if (value === "ConDatos" || value === "SinDatos") return value;
  throw new Error(`Unexpected consulta result: ${JSON.stringify(value)}`);
}

function indicadorPaginacionOf(value: unknown): RespuestaConsulta["IndicadorPaginacion"] {
  if (value === "S" || value === "N") return value;
  throw new Error(`Unexpected pagination indicator: ${JSON.stringify(value)}`);
}

function invoiceIdentityOf(raw: unknown, field: "IDFactura" | "ClavePaginacion"): IDFactura {
  if (Array.isArray(raw)) {
    throw new Error(`${field} must appear once`);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`${field} must contain one invoice identity`);
  }
  const key = raw as Partial<IDFactura>;
  if (
    typeof key.IDEmisorFactura !== "string" ||
    key.IDEmisorFactura.trim().length === 0 ||
    typeof key.NumSerieFactura !== "string" ||
    key.NumSerieFactura.trim().length === 0 ||
    typeof key.FechaExpedicionFactura !== "string" ||
    key.FechaExpedicionFactura.trim().length === 0
  ) {
    throw new Error(`${field} must contain one invoice identity`);
  }
  assertConsultaNif(`${field}.IDEmisorFactura`, key.IDEmisorFactura);
  if (!isValidConsultaNumSerieFactura(key.NumSerieFactura)) {
    throw new Error(`${field}.NumSerieFactura must contain 1 to 60 characters`);
  }
  if (!isValidConsultaFecha(key.FechaExpedicionFactura)) {
    throw new Error(`${field}.FechaExpedicionFactura must be DD-MM-YYYY`);
  }
  return {
    IDEmisorFactura: key.IDEmisorFactura,
    NumSerieFactura: key.NumSerieFactura,
    FechaExpedicionFactura: key.FechaExpedicionFactura,
  };
}

function datosPresentacionOf(raw: unknown): DatosPresentacionConsulta | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw new Error("DatosPresentacion must appear once");
  if (!raw || typeof raw !== "object") {
    throw new Error("DatosPresentacion must contain its three fields");
  }
  const block = raw as Record<string, unknown>;
  assertConsultaNif("DatosPresentacion.NIFPresentador", block.NIFPresentador);
  if (typeof block.TimestampPresentacion !== "string" || !block.TimestampPresentacion.trim()) {
    throw new Error("DatosPresentacion.TimestampPresentacion is required");
  }
  if (typeof block.IdPeticion !== "string" || Array.from(block.IdPeticion).length > 20) {
    throw new Error("DatosPresentacion.IdPeticion must contain at most 20 characters");
  }
  return {
    NIFPresentador: block.NIFPresentador,
    TimestampPresentacion: block.TimestampPresentacion,
    IdPeticion: block.IdPeticion,
  };
}

function parseRegistroConsultado(raw: RawRegistroConsultado): RegistroConsultado {
  const data = raw.DatosRegistroFacturacion;
  if (data === undefined || data === null) {
    throw new Error("Consulta record is missing DatosRegistroFacturacion");
  }
  if (Array.isArray(data)) {
    throw new Error("DatosRegistroFacturacion must appear once");
  }
  // An empty required XML element is a present block, not a missing one.
  const dataBlock = typeof data === "string" && data.trim().length === 0 ? {} : data;
  if (typeof dataBlock !== "object") {
    throw new Error("DatosRegistroFacturacion must contain a record");
  }
  const state = raw.EstadoRegistro;
  if (!state) {
    throw new Error("Consulta record is missing EstadoRegistro");
  }
  const timestamp = state.TimestampUltimaModificacion;
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
    throw new Error("Consulta record is missing TimestampUltimaModificacion");
  }
  return {
    IDFactura: invoiceIdentityOf(raw.IDFactura, "IDFactura"),
    DatosRegistroFacturacion: dataBlock as Record<string, unknown>,
    TimestampUltimaModificacion: timestamp,
    EstadoRegistro: estadoRegistroConsultaOf(state.EstadoRegistro),
    CodigoErrorRegistro: asNumber(state.CodigoErrorRegistro, "CodigoErrorRegistro"),
    DescripcionErrorRegistro: state.DescripcionErrorRegistro,
    DatosPresentacion: datosPresentacionOf(raw.DatosPresentacion),
  };
}

/** Parses a `RespuestaConsultaFactuSistemaFacturacion` SOAP response into a plain object. */
export function parseRespuestaConsulta(xml: string): RespuestaConsulta {
  const parsed = parser.parse(xml) as RawEnvelope;
  const body = parsed.Envelope?.Body?.RespuestaConsultaFactuSistemaFacturacion;
  if (!body) {
    throw new Error("Response does not contain a RespuestaConsultaFactuSistemaFacturacion body");
  }
  const resultadoConsulta = resultadoConsultaOf(body.ResultadoConsulta);
  const indicadorPaginacion = indicadorPaginacionOf(body.IndicadorPaginacion);
  const rawCursor = body.ClavePaginacion;
  if (indicadorPaginacion === "S" && rawCursor === undefined) {
    throw new Error("ClavePaginacion is required when IndicadorPaginacion is S");
  }
  return {
    ResultadoConsulta: resultadoConsulta,
    IndicadorPaginacion: indicadorPaginacion,
    // A final page needs no cursor; ignore an unexpected optional block rather than losing its records.
    ClavePaginacion:
      indicadorPaginacion === "S" ? invoiceIdentityOf(rawCursor, "ClavePaginacion") : undefined,
    registros: asArray(body.RegistroRespuestaConsultaFactuSistemaFacturacion).map(
      parseRegistroConsultado,
    ),
  };
}
