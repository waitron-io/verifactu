import { asArray, asNumber, parser } from "./parse-common.js";
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
  IDFactura: IDFactura;
  DatosRegistroFacturacion: Record<string, unknown>;
  EstadoRegistro: RawEstadoRegistro;
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

function parseIDFactura(raw: IDFactura): IDFactura {
  return {
    IDEmisorFactura: raw.IDEmisorFactura,
    NumSerieFactura: raw.NumSerieFactura,
    FechaExpedicionFactura: raw.FechaExpedicionFactura,
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

function paginationKeyOf(raw: unknown): IDFactura {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("ClavePaginacion must contain one invoice identity");
  }
  const key = raw as Partial<IDFactura>;
  if (
    typeof key.IDEmisorFactura !== "string" ||
    key.IDEmisorFactura.length === 0 ||
    typeof key.NumSerieFactura !== "string" ||
    key.NumSerieFactura.length === 0 ||
    typeof key.FechaExpedicionFactura !== "string" ||
    key.FechaExpedicionFactura.length === 0
  ) {
    throw new Error("ClavePaginacion must contain one invoice identity");
  }
  return {
    IDEmisorFactura: key.IDEmisorFactura,
    NumSerieFactura: key.NumSerieFactura,
    FechaExpedicionFactura: key.FechaExpedicionFactura,
  };
}

function parseRegistroConsultado(raw: RawRegistroConsultado): RegistroConsultado {
  return {
    IDFactura: parseIDFactura(raw.IDFactura),
    DatosRegistroFacturacion: raw.DatosRegistroFacturacion,
    TimestampUltimaModificacion: raw.EstadoRegistro.TimestampUltimaModificacion,
    EstadoRegistro: estadoRegistroConsultaOf(raw.EstadoRegistro.EstadoRegistro),
    CodigoErrorRegistro: asNumber(raw.EstadoRegistro.CodigoErrorRegistro, "CodigoErrorRegistro"),
    DescripcionErrorRegistro: raw.EstadoRegistro.DescripcionErrorRegistro,
    DatosPresentacion: raw.DatosPresentacion
      ? {
          NIFPresentador: raw.DatosPresentacion.NIFPresentador,
          TimestampPresentacion: raw.DatosPresentacion.TimestampPresentacion,
          IdPeticion: raw.DatosPresentacion.IdPeticion,
        }
      : undefined,
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
  if (indicadorPaginacion === "N" && rawCursor !== undefined) {
    throw new Error("ClavePaginacion is forbidden when IndicadorPaginacion is N");
  }
  return {
    ResultadoConsulta: resultadoConsulta,
    IndicadorPaginacion: indicadorPaginacion,
    ClavePaginacion: rawCursor === undefined ? undefined : paginationKeyOf(rawCursor),
    registros: asArray(body.RegistroRespuestaConsultaFactuSistemaFacturacion).map(
      parseRegistroConsultado,
    ),
  };
}
