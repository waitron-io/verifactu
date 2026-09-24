import { createClient, type VerifactuClient } from "../client.js";
import { escapeXml } from "../xml/escape.js";
import { parseConsulta, parseEnvio } from "../xml/parse-request.js";
import type { EstadoRegistroConsulta } from "../xml/parse-consulta.js";
import type {
  EstadoEnvio,
  EstadoRegistroDuplicado,
  EstadoRegistroSuministro,
} from "../xml/parse-suministro.js";
import type {
  ConsultaFiltro,
  EnvioRegistro,
  SistemaInformaticoConsulta,
} from "../xml/serialize.js";
import {
  isAlta,
  type Destinatario,
  type IDFactura,
  type RegistroAlta,
  type RegistroAnulacion,
  type SistemaInformatico,
} from "../types.js";

export type FacturaKey = string;

export interface StoredRecord {
  key: FacturaKey;
  huella: string;
  estado: EstadoRegistroConsulta;
  tipo: "alta" | "anulacion";
  refExterna?: string;
}

interface StoredMetadata {
  nombreRazonEmisor: string;
  destinatarios: Destinatario[];
  sistema: SistemaInformatico;
}

function samePersona(left: Destinatario, right: Destinatario): boolean {
  if (left.NombreRazon !== right.NombreRazon) return false;
  if (left.NIF !== undefined) return left.NIF === right.NIF;
  if (right.IDOtro === undefined) return false;
  return (
    left.IDOtro.CodigoPais === right.IDOtro.CodigoPais &&
    left.IDOtro.IDType === right.IDOtro.IDType &&
    left.IDOtro.ID === right.IDOtro.ID
  );
}

function matchesSistema(
  stored: SistemaInformatico,
  requested: SistemaInformaticoConsulta,
): boolean {
  return (
    samePersona(stored, requested) &&
    stored.IdSistemaInformatico === requested.IdSistemaInformatico &&
    stored.NumeroInstalacion === requested.NumeroInstalacion &&
    (requested.NombreSistemaInformatico === undefined ||
      stored.NombreSistemaInformatico === requested.NombreSistemaInformatico) &&
    (requested.Version === undefined || stored.Version === requested.Version) &&
    (requested.TipoUsoPosibleSoloVerifactu === undefined ||
      stored.TipoUsoPosibleSoloVerifactu === requested.TipoUsoPosibleSoloVerifactu) &&
    (requested.TipoUsoPosibleMultiOT === undefined ||
      stored.TipoUsoPosibleMultiOT === requested.TipoUsoPosibleMultiOT) &&
    (requested.IndicadorMultiplesOT === undefined ||
      stored.IndicadorMultiplesOT === requested.IndicadorMultiplesOT)
  );
}

export interface FakeAeatOptions {
  serverNow?: Date;
  tiempoEsperaInicial?: number;
  /** Page size for a consulta sweep's `IndicadorPaginacion`/`ClavePaginacion` — small by default so multi-page fixtures stay cheap. */
  consultaPageSize?: number;
}

export interface FakeAeat {
  fetch: typeof globalThis.fetch;
  client(): VerifactuClient;
  setServerNow(now: Date): void;
  reject(key: FacturaKey, code: number, message: string): void;
  stored(): StoredRecord[];
  /** Forces the next resubmit of `key` to omit `RegistroDuplicado.EstadoRegistroDuplicado` (the duplicate_unknown case). */
  dropRegistroDuplicadoDetail(key: FacturaKey): void;
  /**
   * Marks a stored record `Anulado` without synthesizing a RegistroAnulacion. This state-only hook
   * deliberately retains the existing record kind and hash; submit a real cancellation when a test
   * needs AEAT's cancellation snapshot.
   */
  annul(key: FacturaKey): void;
  /** Overrides only the consulta-reported state; `annul` is its `Anulado` shorthand. */
  setConsultaState(key: FacturaKey, estado: StoredRecord["estado"]): void;
  /** Evicts a stored record entirely, driving the `SinDatos`/no-trace consulta path. */
  forget(key: FacturaKey): void;
}

interface Identity {
  idf: IDFactura;
  tipo: "alta" | "anulacion";
  huella: string;
  ref: string | undefined;
  fecha: string;
}

/**
 * Reads the invoice identity out of either registro shape. A RegistroAnulacion's own IDFactura
 * uses the ...Anulada field names, but it names the SAME invoice its alta did — so this maps it
 * back onto the alta-shaped {IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura} triple that
 * both `keyOf` and the response XML (sf:IDFacturaType, shared by both record kinds) use.
 */
function identityOf(entry: EnvioRegistro): Identity {
  if ("RegistroAlta" in entry) {
    const r = entry.RegistroAlta;
    return {
      idf: r.IDFactura,
      tipo: "alta",
      huella: r.Huella,
      ref: r.RefExterna,
      fecha: r.IDFactura.FechaExpedicionFactura,
    };
  }
  const r = entry.RegistroAnulacion;
  const idf: IDFactura = {
    IDEmisorFactura: r.IDFactura.IDEmisorFacturaAnulada,
    NumSerieFactura: r.IDFactura.NumSerieFacturaAnulada,
    FechaExpedicionFactura: r.IDFactura.FechaExpedicionFacturaAnulada,
  };
  return {
    idf,
    tipo: "anulacion",
    huella: r.Huella,
    ref: r.RefExterna,
    fecha: idf.FechaExpedicionFactura,
  };
}

function keyOfIdentity(idf: IDFactura): FacturaKey {
  return `${idf.IDEmisorFactura}|${idf.NumSerieFactura}|${idf.FechaExpedicionFactura}`;
}

/** The identity key for a bare record — e.g. to build the argument for `reject()`. */
export function keyOf(record: RegistroAlta | RegistroAnulacion): FacturaKey {
  const entry: EnvioRegistro = isAlta(record)
    ? { RegistroAlta: record }
    : { RegistroAnulacion: record };
  return keyOfIdentity(identityOf(entry).idf);
}

// "DD-MM-YYYY" (AEAT's sf:fecha) → a UTC Date at midnight, for the future-dating (2004) check.
function fechaToDate(ddMmYyyy: string): Date {
  const [dd, mm, yyyy] = ddMmYyyy.split("-");
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
}

export function createFakeAeat(options: FakeAeatOptions = {}): FakeAeat {
  const store = new Map<FacturaKey, StoredRecord>();
  const metadata = new Map<FacturaKey, StoredMetadata>();
  const rejections = new Map<FacturaKey, { code: number; message: string }>();
  // Keys for which the next resubmit's 3000 response omits RegistroDuplicado.EstadoRegistroDuplicado
  // entirely (AEAT reporting a duplicate without saying what it holds — duplicate_unknown).
  const noDuplicadoDetail = new Set<FacturaKey>();
  let serverNow = options.serverNow ?? new Date("2026-07-21T00:00:00Z");
  // Clamped into TiempoEsperaEnvio's own schema domain (`\d{0,4}` — at most 9999, and a real wait
  // is always >= 1): a caller (e.g. fiscal-verifactu's drain.test.ts round-trip test) may pass an
  // out-of-domain `tiempoEsperaInicial` deliberately, to prove the CONSUMER handles the extremes
  // the real schema allows rather than whatever arbitrary number a test author typed. Reporting a
  // value the real AEAT could never send would make that a test of nothing.
  let tiempoEspera = Math.max(1, Math.min(9999, options.tiempoEsperaInicial ?? 60));
  let csvSequence = 0;
  const consultaPageSize = options.consultaPageSize ?? 2;

  function handleEnvio(xml: string): string {
    const { cabecera, registros } = parseEnvio(xml);
    const lineas: string[] = [];
    let anyRejected = false;
    // Every non-rejected envío issues exactly one CSV (Task 3 will suppress it when the whole
    // envío is Incorrecto).
    const csv = `CSV-${String(++csvSequence).padStart(8, "0")}`;
    for (const entry of registros) {
      const { idf, tipo, huella, ref, fecha } = identityOf(entry);
      const key = keyOfIdentity(idf);
      const existing = store.get(key);
      const forced = rejections.get(key);
      const future = fechaToDate(fecha).getTime() > serverNow.getTime();
      if (
        existing &&
        !(tipo === "anulacion" && existing.tipo === "alta" && existing.estado !== "Anulado")
      ) {
        // Anulación of a live alta changes its state; all other resubmissions leave the stored
        // record untouched. The outer Incorrecto line carries the stored state in
        // RegistroDuplicado; resolveEstadoEfectivo reads that inner state.
        anyRejected = true;
        const detail = noDuplicadoDetail.has(key) ? undefined : duplicateStateOf(existing.estado);
        lineas.push(duplicadoLineaXml(idf, detail, ref));
        continue;
      }
      if (forced) {
        anyRejected = true;
        lineas.push(lineaXml(idf, "Incorrecto", forced.code, forced.message, ref));
      } else {
        const estado =
          tipo === "anulacion" ? "Anulado" : future ? "AceptadoConErrores" : "Correcto";
        // Consulta exposes the latest record for an invoice identity. This one-row fake therefore
        // replaces an alta snapshot with the accepted anulación's hash, kind, and external reference.
        store.set(key, {
          key,
          huella,
          estado,
          tipo,
          refExterna: ref ?? existing?.refExterna,
        });
        if (!existing) {
          metadata.set(
            key,
            "RegistroAlta" in entry
              ? {
                  nombreRazonEmisor: entry.RegistroAlta.NombreRazonEmisor,
                  destinatarios: entry.RegistroAlta.Destinatarios?.IDDestinatario ?? [],
                  sistema: entry.RegistroAlta.SistemaInformatico,
                }
              : {
                  nombreRazonEmisor: cabecera.ObligadoEmision.NombreRazon,
                  destinatarios: [],
                  sistema: entry.RegistroAnulacion.SistemaInformatico,
                },
          );
        }
        if (future) {
          // 2004 is non-rejecting: the record is stored and the line reads AceptadoConErrores.
          lineas.push(
            lineaXml(
              idf,
              "AceptadoConErrores",
              2004,
              "Fecha de expedición posterior a la fecha del sistema",
              ref,
            ),
          );
        } else {
          lineas.push(lineaXml(idf, "Correcto", undefined, undefined, ref));
        }
      }
    }
    // Hands back the CURRENT wait time (what this response is telling the caller to honour before
    // its next submission), then decrements for the NEXT call — decrementing first would report a
    // wait time one step ahead of what this very response is describing.
    const tiempoParaEsteEnvio = tiempoEspera;
    tiempoEspera = Math.max(1, tiempoEspera - 1);
    return suministroEnvelope(
      csv,
      anyRejected ? "ParcialmenteCorrecto" : "Correcto",
      tiempoParaEsteEnvio,
      lineas,
    );
  }

  function handleConsulta(xml: string): string {
    const { cabecera, filtro } = parseConsulta(xml);
    // Always scoped to the querying obligado's own NIF (IDEmisorFactura) — a consulta can never
    // return another obligado's records. NumSerieFactura/FechaExpedicionFactura are optional
    // NARROWING filters on top of that: a targeted single-record lookup (Route B) supplies both
    // (and previously required both — 3b widens the same match into a paged period sweep, where
    // neither is supplied and every in-NIF record is a candidate). All stored records are
    // in-period for the fake's fixtures, so PeriodoImputacion itself is not re-derived here — the
    // fixtures control which records exist.
    const queryingIssuer = cabecera.ObligadoEmision;
    let all = [...store.values()].filter((s) => {
      if (queryingIssuer !== undefined) return s.key.split("|")[0] === queryingIssuer.NIF;
      return (metadata.get(s.key)?.destinatarios ?? []).some((recipient) =>
        samePersona(recipient, cabecera.Destinatario),
      );
    });
    if (filtro.NumSerieFactura !== undefined) {
      all = all.filter((s) => s.key.split("|")[1] === filtro.NumSerieFactura);
    }
    if (filtro.FechaExpedicionFactura !== undefined) {
      all = all.filter((s) => s.key.split("|")[2] === filtro.FechaExpedicionFactura);
    }
    if (filtro.RangoFechaExpedicion !== undefined) {
      const sortableDate = (value: string) => {
        const [day, month, year] = value.split("-");
        return `${year}-${month}-${day}`;
      };
      const desde = filtro.RangoFechaExpedicion.Desde;
      const hasta = filtro.RangoFechaExpedicion.Hasta;
      all = all.filter((s) => {
        const date = sortableDate(s.key.split("|")[2] ?? "");
        return (
          (desde === undefined || date >= sortableDate(desde)) &&
          (hasta === undefined || date <= sortableDate(hasta))
        );
      });
    }
    const contraparte = filtro.Contraparte;
    if (contraparte !== undefined) {
      all = all.filter((s) => {
        if (queryingIssuer !== undefined) {
          return (metadata.get(s.key)?.destinatarios ?? []).some((recipient) =>
            samePersona(recipient, contraparte),
          );
        }
        return samePersona(
          {
            NombreRazon: metadata.get(s.key)?.nombreRazonEmisor ?? "",
            NIF: s.key.split("|")[0] ?? "",
          },
          contraparte,
        );
      });
    }
    const sistemaFiltro = filtro.SistemaInformatico;
    if (sistemaFiltro !== undefined) {
      all = all.filter((s) => {
        const sistema = metadata.get(s.key)?.sistema;
        return sistema !== undefined && matchesSistema(sistema, sistemaFiltro);
      });
    }
    if (filtro.RefExterna !== undefined) {
      all = all.filter((s) => s.refExterna === filtro.RefExterna);
    }
    // Continue after ClavePaginacion (match by the last-returned identity), ordered by insertion.
    // If that identity is no longer found (e.g. `forget`ten between pages), fall back to the full
    // filtered set rather than throwing — a stale cursor is a caller bug this fake surfaces as
    // "start over", not a crash.
    if (filtro.ClavePaginacion !== undefined) {
      const afterKey = `${filtro.ClavePaginacion.IDEmisorFactura}|${filtro.ClavePaginacion.NumSerieFactura}|${filtro.ClavePaginacion.FechaExpedicionFactura}`;
      const idx = all.findIndex((s) => s.key === afterKey);
      all = idx >= 0 ? all.slice(idx + 1) : all;
    }
    const page = all.slice(0, consultaPageSize);
    const more = all.length > consultaPageSize;
    return consultaEnvelope(page, more, metadata, filtro.DatosAdicionalesRespuesta);
  }

  const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? "");
    // Dispatch on the consulta operation ELEMENT tag, not a bare substring: a user-controlled leaf
    // value (e.g. NombreRazon/DescripcionOperacion) could legitimately contain the literal text
    // "ConsultaFactuSistemaFacturacion" and mis-route a genuine envío. `escapeXml` escapes `<`/`>`
    // in leaf content, so the `<…ConsultaFactuSistemaFacturacion>` tag form can only come from a real
    // element and cannot be spoofed. (Envío's root is RegFactuSistemaFacturacion.)
    const xml = /<[^<>]*ConsultaFactuSistemaFacturacion>/.test(body)
      ? handleConsulta(body)
      : handleEnvio(body);
    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  };

  return {
    fetch: fetchImpl,
    client: () => createClient({ endpoint: "https://fake.aeat.test/soap", fetch: fetchImpl }),
    setServerNow: (now) => {
      serverNow = now;
    },
    reject: (key, code, message) => rejections.set(key, { code, message }),
    stored: () => [...store.values()],
    dropRegistroDuplicadoDetail: (key) => {
      noDuplicadoDetail.add(key);
    },
    annul: (key) => {
      const s = store.get(key);
      if (s) s.estado = "Anulado";
    },
    setConsultaState: (key, estado) => {
      assertConsultaState(estado);
      const s = store.get(key);
      if (s) s.estado = estado;
    },
    forget: (key) => {
      store.delete(key);
      metadata.delete(key);
    },
  };
}

// --- response XML builders (parsed by the unmodified parseRespuestaSuministro) --------------
// Namespace prefixes below are arbitrary: parse-common's shared parser has removeNSPrefix:true,
// so only the local element names need to match what parse-suministro.ts reads.

function lineaXml(
  idf: IDFactura,
  estado: EstadoRegistroSuministro,
  code: number | undefined,
  message: string | undefined,
  ref: string | undefined,
): string {
  return (
    "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    `<sfR:EstadoRegistro>${estado}</sfR:EstadoRegistro>` +
    (code !== undefined ? `<sfR:CodigoErrorRegistro>${code}</sfR:CodigoErrorRegistro>` : "") +
    (message !== undefined
      ? `<sfR:DescripcionErrorRegistro>${escapeXml(message)}</sfR:DescripcionErrorRegistro>`
      : "") +
    "</sfR:RespuestaLinea>"
  );
}

function suministroEnvelope(
  csv: string,
  estadoEnvio: EstadoEnvio,
  tiempo: number,
  lineas: string[],
): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfR="sfR"><soapenv:Body>` +
    "<sfR:RespuestaRegFactuSistemaFacturacion>" +
    `<sfR:CSV>${escapeXml(csv)}</sfR:CSV>` +
    `<sfR:EstadoEnvio>${estadoEnvio}</sfR:EstadoEnvio>` +
    `<sfR:TiempoEsperaEnvio>${tiempo}</sfR:TiempoEsperaEnvio>` +
    lineas.join("") +
    "</sfR:RespuestaRegFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}

/** A 3000 (Registro duplicado) response line. `estadoDuplicado` undefined models the
 *  duplicate_unknown case: AEAT reporting a duplicate without saying what it holds. */
function duplicadoLineaXml(
  idf: IDFactura,
  estadoDuplicado: EstadoRegistroDuplicado | undefined,
  ref: string | undefined,
): string {
  return (
    "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    "<sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>" +
    "<sfR:CodigoErrorRegistro>3000</sfR:CodigoErrorRegistro>" +
    "<sfR:DescripcionErrorRegistro>Registro duplicado</sfR:DescripcionErrorRegistro>" +
    "<sfR:RegistroDuplicado>" +
    (estadoDuplicado !== undefined
      ? `<sfR:EstadoRegistroDuplicado>${estadoDuplicado}</sfR:EstadoRegistroDuplicado>`
      : "") +
    "</sfR:RegistroDuplicado>" +
    "</sfR:RespuestaLinea>"
  );
}

function duplicateStateOf(estado: EstadoRegistroConsulta): EstadoRegistroDuplicado {
  switch (estado) {
    case "Correcto":
      return "Correcta";
    case "AceptadoConErrores":
      return "AceptadaConErrores";
    case "Anulado":
      return "Anulada";
  }
}

function assertConsultaState(estado: string): asserts estado is EstadoRegistroConsulta {
  if (!["Correcto", "AceptadoConErrores", "Anulado"].includes(estado)) {
    throw new Error(`Invalid consulta record state: ${estado}`);
  }
}

// --- consulta response XML builder (parsed by the unmodified parseRespuestaConsulta) ---------

/** `<sfRC:ClavePaginacion>`, built from a stored record's own key — echoed verbatim by a caller's next request. */
function clavePaginacionXml(s: StoredRecord): string {
  const [emisor, serie, fecha] = s.key.split("|");
  return (
    "<sfRC:ClavePaginacion>" +
    `<sf:IDEmisorFactura>${escapeXml(emisor)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(serie)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(fecha)}</sf:FechaExpedicionFactura>` +
    "</sfRC:ClavePaginacion>"
  );
}

function sfValueXml(name: string, value: string | undefined): string {
  return value === undefined ? "" : `<sf:${name}>${escapeXml(value)}</sf:${name}>`;
}

function sistemaConsultaXml(value: SistemaInformatico): string {
  const identity =
    value.NIF !== undefined
      ? sfValueXml("NIF", value.NIF)
      : "<sf:IDOtro>" +
        sfValueXml("CodigoPais", value.IDOtro.CodigoPais) +
        sfValueXml("IDType", value.IDOtro.IDType) +
        sfValueXml("ID", value.IDOtro.ID) +
        "</sf:IDOtro>";
  return (
    "<sfRC:SistemaInformatico>" +
    `<sf:NombreRazon>${escapeXml(value.NombreRazon)}</sf:NombreRazon>` +
    identity +
    `<sf:NombreSistemaInformatico>${escapeXml(value.NombreSistemaInformatico)}</sf:NombreSistemaInformatico>` +
    `<sf:IdSistemaInformatico>${escapeXml(value.IdSistemaInformatico)}</sf:IdSistemaInformatico>` +
    `<sf:Version>${escapeXml(value.Version)}</sf:Version>` +
    `<sf:NumeroInstalacion>${escapeXml(value.NumeroInstalacion)}</sf:NumeroInstalacion>` +
    sfValueXml("TipoUsoPosibleSoloVerifactu", value.TipoUsoPosibleSoloVerifactu) +
    sfValueXml("TipoUsoPosibleMultiOT", value.TipoUsoPosibleMultiOT) +
    sfValueXml("IndicadorMultiplesOT", value.IndicadorMultiplesOT) +
    "</sfRC:SistemaInformatico>"
  );
}

/** `matches` is the already-paged slice to return; `more` says whether further pages remain beyond it. */
function consultaEnvelope(
  matches: StoredRecord[],
  more: boolean,
  metadata: Map<FacturaKey, StoredMetadata>,
  responseOptions: ConsultaFiltro["DatosAdicionalesRespuesta"],
): string {
  const registros = matches
    .map((s) => {
      const [emisor, serie, fecha] = s.key.split("|");
      const details = metadata.get(s.key);
      return (
        "<sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>" +
        "<sfRC:IDFactura>" +
        `<sf:IDEmisorFactura>${escapeXml(emisor)}</sf:IDEmisorFactura>` +
        `<sf:NumSerieFactura>${escapeXml(serie)}</sf:NumSerieFactura>` +
        `<sf:FechaExpedicionFactura>${escapeXml(fecha)}</sf:FechaExpedicionFactura>` +
        "</sfRC:IDFactura>" +
        "<sfRC:DatosRegistroFacturacion>" +
        (responseOptions?.MostrarNombreRazonEmisor === "S" && details
          ? `<sfRC:NombreRazonEmisor>${escapeXml(details.nombreRazonEmisor)}</sfRC:NombreRazonEmisor>`
          : "") +
        (s.refExterna !== undefined
          ? `<sf:RefExterna>${escapeXml(s.refExterna)}</sf:RefExterna>`
          : "") +
        (responseOptions?.MostrarSistemaInformatico === "S" && details
          ? sistemaConsultaXml(details.sistema)
          : "") +
        `<sf:TipoHuella>01</sf:TipoHuella><sf:Huella>${escapeXml(s.huella)}</sf:Huella>` +
        "</sfRC:DatosRegistroFacturacion>" +
        "<sfRC:EstadoRegistro>" +
        "<sf:TimestampUltimaModificacion>2026-07-21T00:00:00+00:00</sf:TimestampUltimaModificacion>" +
        `<sf:EstadoRegistro>${s.estado}</sf:EstadoRegistro>` +
        "</sfRC:EstadoRegistro>" +
        "</sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>"
      );
    })
    .join("");
  const last = matches[matches.length - 1];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="sf" xmlns:sfRC="sfRC"><soapenv:Body>` +
    "<sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    `<sfRC:ResultadoConsulta>${matches.length > 0 ? "ConDatos" : "SinDatos"}</sfRC:ResultadoConsulta>` +
    `<sfRC:IndicadorPaginacion>${more ? "S" : "N"}</sfRC:IndicadorPaginacion>` +
    (more && last ? clavePaginacionXml(last) : "") +
    registros +
    "</sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}
