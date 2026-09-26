import { createClient, type VerifactuClient } from "../client.js";
import { escapeXml } from "../xml/escape.js";
import { parseConsulta, parseEnvioUnchecked } from "../xml/parse-request.js";
import type { EstadoRegistroConsulta } from "../xml/parse-consulta.js";
import type {
  EstadoEnvio,
  EstadoRegistroDuplicado,
  EstadoRegistroSuministro,
} from "../xml/parse-suministro.js";
import type {
  Cabecera,
  CabeceraConsulta,
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

const NS_SF =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd";
const NS_RC =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd";

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
  /** Omits the optional `RegistroDuplicado` block on resubmit (the duplicate_unknown case). */
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
  fechaHoraHusoGenRegistro: string;
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
      fechaHoraHusoGenRegistro: r.FechaHoraHusoGenRegistro,
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
    fechaHoraHusoGenRegistro: r.FechaHoraHusoGenRegistro,
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
  // A duplicate echoes the petition that stored the earlier record, not the current request.
  const petitionIds = new Map<FacturaKey, string>();
  const metadata = new Map<FacturaKey, StoredMetadata>();
  const rejections = new Map<FacturaKey, { code: number; message: string }>();
  const rejectedOperations = new Map<FacturaKey, Set<"alta-subsanacion" | "anulacion">>();
  // Keys for which a 3000 response omits the optional duplicate-detail block, leaving the
  // caller to reconcile the unknown stored state through consulta.
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
    const { cabecera, registros } = parseEnvioUnchecked(xml);
    const lineas: string[] = [];
    let rejectedCount = 0;
    let anyAcceptedWithErrors = false;
    // The synthetic petition ID and the CSV for a non-rejected batch share this sequence.
    const csv = `CSV-${String(++csvSequence).padStart(8, "0")}`;
    for (const entry of registros) {
      const { idf, tipo, huella, ref, fecha, fechaHoraHusoGenRegistro } = identityOf(entry);
      const operacion = operacionXml(entry);
      const key = keyOfIdentity(idf);
      const existing = store.get(key);
      const forced = rejections.get(key);
      const futureInvoiceDate = fechaToDate(fecha).getTime() > serverNow.getTime();
      const futureGenerationTime = Date.parse(fechaHoraHusoGenRegistro) > serverNow.getTime();
      const alta = "RegistroAlta" in entry ? entry.RegistroAlta : undefined;
      const anulacion = "RegistroAnulacion" in entry ? entry.RegistroAnulacion : undefined;
      const rejectedOperation =
        alta?.Subsanacion === "S" ? "alta-subsanacion" : anulacion ? "anulacion" : undefined;
      const previousRejections = rejectedOperations.get(key);
      const hasRejectedSubsanacion = previousRejections?.has("alta-subsanacion") ?? false;
      const hasRejectedCancellation = previousRejections?.has("anulacion") ?? false;
      const rejectLine = (line: string): void => {
        rejectedCount += 1;
        lineas.push(line);
        if (rejectedOperation !== undefined) {
          const history = rejectedOperations.get(key) ?? new Set();
          history.add(rejectedOperation);
          rejectedOperations.set(key, history);
        }
      };
      const isNormalSubsanacion =
        alta?.Subsanacion === "S" &&
        (alta.RechazoPrevio === undefined ||
          alta.RechazoPrevio === "N" ||
          (alta.RechazoPrevio === "S" && hasRejectedSubsanacion));
      const replacesExistingAlta = existing !== undefined && isNormalSubsanacion;
      const permitsCancellationReplacement =
        anulacion !== undefined &&
        (anulacion.RechazoPrevio === undefined ||
          anulacion.RechazoPrevio === "N" ||
          (anulacion.RechazoPrevio === "S" && hasRejectedCancellation));
      // A changed hash or reference marks new cancellation data; an exact retry stays a duplicate.
      const replacesExistingCancellation =
        existing?.tipo === "anulacion" &&
        permitsCancellationReplacement &&
        (existing.huella !== huella || (ref !== undefined && existing.refExterna !== ref));
      if (!forced && alta?.RechazoPrevio === "S" && alta.Subsanacion !== "S") {
        rejectLine(
          lineaXml(
            idf,
            "Incorrecto",
            1161,
            "El valor del campo RechazoPrevio no es válido, no podrá incluirse el campo RechazoPrevio con valor S si no se ha informado del campo Subsanacion o tiene el valor N.",
            ref,
            operacion,
          ),
        );
        continue;
      }
      // A normal subsanación replaces an AEAT record; only RechazoPrevio=X permits no prior record.
      if (!forced && !existing && alta?.Subsanacion === "S" && alta.RechazoPrevio !== "X") {
        rejectLine(
          lineaXml(idf, "Incorrecto", 3002, "No existe el registro de facturación", ref, operacion),
        );
        continue;
      }
      if (!forced && existing && alta?.RechazoPrevio === "S" && !hasRejectedSubsanacion) {
        rejectLine(
          lineaXml(idf, "Incorrecto", 1275, "Valor incorrecto campo RechazoPrevio", ref, operacion),
        );
        continue;
      }
      if (!forced && anulacion?.RechazoPrevio === "S" && !hasRejectedCancellation) {
        rejectLine(
          lineaXml(idf, "Incorrecto", 1275, "Valor incorrecto campo RechazoPrevio", ref, operacion),
        );
        continue;
      }
      if (
        !forced &&
        anulacion?.SinRegistroPrevio !== undefined &&
        anulacion.SinRegistroPrevio !== "S" &&
        anulacion.SinRegistroPrevio !== "N"
      ) {
        rejectLine(
          lineaXml(
            idf,
            "Incorrecto",
            1276,
            "Valor incorrecto campo SinRegistroPrevio",
            ref,
            operacion,
          ),
        );
        continue;
      }
      // A normal cancellation needs a stored record; SinRegistroPrevio=S is the no-prior path.
      if (!forced && !existing && anulacion && anulacion.SinRegistroPrevio !== "S") {
        rejectLine(
          lineaXml(idf, "Incorrecto", 3002, "No existe el registro de facturación", ref, operacion),
        );
        continue;
      }
      if (!forced && existing && anulacion?.SinRegistroPrevio === "S") {
        // The stored record is not an accepted instance of this refused cancellation.
        rejectLine(duplicadoLineaXml(idf, undefined, ref, operacion, undefined));
        continue;
      }
      // An already stored identity stays a duplicate if a test moves the fake clock backwards;
      // keeping duplicate detail lets resolveEstadoEfectivo recover the stored state.
      if (
        existing &&
        !(
          tipo === "anulacion" &&
          anulacion?.SinRegistroPrevio !== "S" &&
          existing.tipo === "alta" &&
          existing.estado !== "Anulado"
        ) &&
        !replacesExistingAlta &&
        !replacesExistingCancellation
      ) {
        // Only an allowed cancellation or subsanación can replace stored state. A duplicate
        // leaves it untouched and reports that state for resolveEstadoEfectivo.
        const detail = noDuplicadoDetail.has(key) ? undefined : duplicateStateOf(existing.estado);
        const storedPetitionId = petitionIds.get(key);
        if (detail !== undefined && storedPetitionId === undefined) {
          throw new Error(`Fake AEAT has no petition ID for stored record ${key}`);
        }
        rejectLine(duplicadoLineaXml(idf, detail, ref, operacion, storedPetitionId));
        continue;
      }
      if (!forced && futureInvoiceDate) {
        rejectLine(
          lineaXml(
            idf,
            "Incorrecto",
            1112,
            "El campo FechaExpedicionFactura es superior a la fecha actual.",
            ref,
            operacion,
          ),
        );
        continue;
      }
      if (forced) {
        rejectLine(lineaXml(idf, "Incorrecto", forced.code, forced.message, ref, operacion));
      } else {
        const estado =
          tipo === "anulacion"
            ? "Anulado"
            : futureGenerationTime
              ? "AceptadoConErrores"
              : "Correcto";
        // Consulta exposes the latest record for an invoice identity. This one-row fake therefore
        // replaces an alta snapshot with the accepted anulación's hash, kind, and external reference.
        store.set(key, {
          key,
          huella,
          estado,
          tipo,
          refExterna: tipo === "anulacion" ? (ref ?? existing?.refExterna) : ref,
        });
        petitionIds.set(key, `PET-${String(csvSequence).padStart(8, "0")}`);
        if (alta?.Subsanacion === "S") previousRejections?.delete("alta-subsanacion");
        if (anulacion) previousRejections?.delete("anulacion");
        if (previousRejections?.size === 0) rejectedOperations.delete(key);
        if (alta) {
          metadata.set(key, {
            nombreRazonEmisor: alta.NombreRazonEmisor,
            destinatarios: alta.Destinatarios?.IDDestinatario ?? [],
            sistema: alta.SistemaInformatico,
          });
        } else if (anulacion) {
          // Cancellation has no buyer list; preserve any previously stored issuer and recipients.
          const prior = metadata.get(key);
          metadata.set(key, {
            nombreRazonEmisor: prior?.nombreRazonEmisor ?? cabecera.ObligadoEmision.NombreRazon,
            destinatarios: prior?.destinatarios ?? [],
            sistema: anulacion.SistemaInformatico,
          });
        }
        if (futureGenerationTime) {
          // 2004 is non-rejecting: the record is stored and the line reads AceptadoConErrores.
          anyAcceptedWithErrors = true;
          lineas.push(
            lineaXml(
              idf,
              "AceptadoConErrores",
              2004,
              "El valor del campo FechaHoraHusoGenRegistro debe ser la fecha actual del sistema de la AEAT, admitiéndose un margen de error de:",
              ref,
              operacion,
            ),
          );
        } else {
          lineas.push(lineaXml(idf, "Correcto", undefined, undefined, ref, operacion));
        }
      }
    }
    // Hands back the CURRENT wait time (what this response is telling the caller to honour before
    // its next submission), then decrements for the NEXT call — decrementing first would report a
    // wait time one step ahead of what this very response is describing.
    const tiempoParaEsteEnvio = tiempoEspera;
    tiempoEspera = Math.max(1, tiempoEspera - 1);
    const estadoEnvio: EstadoEnvio =
      rejectedCount === registros.length
        ? "Incorrecto"
        : rejectedCount > 0 || anyAcceptedWithErrors
          ? "ParcialmenteCorrecto"
          : "Correcto";
    return suministroEnvelope(
      cabecera,
      estadoEnvio === "Incorrecto" ? undefined : csv,
      estadoEnvio,
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
    return consultaEnvelope(
      cabecera,
      filtro,
      page,
      more,
      metadata,
      filtro.DatosAdicionalesRespuesta,
    );
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
      petitionIds.delete(key);
      metadata.delete(key);
      rejectedOperations.delete(key);
    },
  };
}

// --- response XML builders (parsed by the unmodified parseRespuestaSuministro) --------------
// Namespace prefixes below are arbitrary: parse-common's shared parser has removeNSPrefix:true,
// so only the local element names need to match what parse-suministro.ts reads.

function operacionXml(entry: EnvioRegistro): string {
  const alta = "RegistroAlta" in entry ? entry.RegistroAlta : undefined;
  const anulacion = "RegistroAnulacion" in entry ? entry.RegistroAnulacion : undefined;
  const rechazoPrevio = alta?.RechazoPrevio ?? anulacion?.RechazoPrevio;
  return (
    "<sfR:Operacion>" +
    `<sf:TipoOperacion>${alta ? "Alta" : "Anulacion"}</sf:TipoOperacion>` +
    (alta?.Subsanacion !== undefined
      ? `<sf:Subsanacion>${alta.Subsanacion}</sf:Subsanacion>`
      : "") +
    (rechazoPrevio !== undefined ? `<sf:RechazoPrevio>${rechazoPrevio}</sf:RechazoPrevio>` : "") +
    (anulacion?.SinRegistroPrevio !== undefined
      ? `<sf:SinRegistroPrevio>${anulacion.SinRegistroPrevio}</sf:SinRegistroPrevio>`
      : "") +
    "</sfR:Operacion>"
  );
}

function lineaXml(
  idf: IDFactura,
  estado: EstadoRegistroSuministro,
  code: number | undefined,
  message: string | undefined,
  ref: string | undefined,
  operacion: string,
): string {
  return (
    "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    operacion +
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
  cabecera: Cabecera,
  csv: string | undefined,
  estadoEnvio: EstadoEnvio,
  tiempo: number,
  lineas: string[],
): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd" ` +
    `xmlns:sfR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaSuministro.xsd"><soapenv:Body>` +
    "<sfR:RespuestaRegFactuSistemaFacturacion>" +
    (csv === undefined ? "" : `<sfR:CSV>${escapeXml(csv)}</sfR:CSV>`) +
    responseCabeceraXml(cabecera) +
    `<sfR:TiempoEsperaEnvio>${tiempo}</sfR:TiempoEsperaEnvio>` +
    `<sfR:EstadoEnvio>${estadoEnvio}</sfR:EstadoEnvio>` +
    lineas.join("") +
    "</sfR:RespuestaRegFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}

function personaEsXml(name: string, person: { NombreRazon: string; NIF: string }): string {
  return (
    `<sf:${name}>` +
    `<sf:NombreRazon>${escapeXml(person.NombreRazon)}</sf:NombreRazon>` +
    `<sf:NIF>${escapeXml(person.NIF)}</sf:NIF>` +
    `</sf:${name}>`
  );
}

function responseCabeceraXml(cabecera: Cabecera): string {
  return (
    "<sfR:Cabecera>" +
    personaEsXml("ObligadoEmision", cabecera.ObligadoEmision) +
    (cabecera.Representante ? personaEsXml("Representante", cabecera.Representante) : "") +
    (cabecera.RemisionVoluntaria
      ? "<sf:RemisionVoluntaria>" +
        (cabecera.RemisionVoluntaria.FechaFinVeriFactu === undefined
          ? ""
          : `<sf:FechaFinVeriFactu>${escapeXml(cabecera.RemisionVoluntaria.FechaFinVeriFactu)}</sf:FechaFinVeriFactu>`) +
        (cabecera.RemisionVoluntaria.Incidencia === undefined
          ? ""
          : `<sf:Incidencia>${cabecera.RemisionVoluntaria.Incidencia}</sf:Incidencia>`) +
        "</sf:RemisionVoluntaria>"
      : "") +
    (cabecera.RemisionRequerimiento
      ? "<sf:RemisionRequerimiento>" +
        `<sf:RefRequerimiento>${escapeXml(cabecera.RemisionRequerimiento.RefRequerimiento)}</sf:RefRequerimiento>` +
        (cabecera.RemisionRequerimiento.FinRequerimiento === undefined
          ? ""
          : `<sf:FinRequerimiento>${cabecera.RemisionRequerimiento.FinRequerimiento}</sf:FinRequerimiento>`) +
        "</sf:RemisionRequerimiento>"
      : "") +
    "</sfR:Cabecera>"
  );
}

/** A 3000 response. Without detail, omit the optional block rather than emitting an
 *  empty RegistroDuplicado, whose child fields the XSD requires. */
function duplicadoLineaXml(
  idf: IDFactura,
  estadoDuplicado: EstadoRegistroDuplicado | undefined,
  ref: string | undefined,
  operacion: string,
  idPeticion: string | undefined,
): string {
  return (
    "<sfR:RespuestaLinea>" +
    "<sfR:IDFactura>" +
    `<sf:IDEmisorFactura>${escapeXml(idf.IDEmisorFactura)}</sf:IDEmisorFactura>` +
    `<sf:NumSerieFactura>${escapeXml(idf.NumSerieFactura)}</sf:NumSerieFactura>` +
    `<sf:FechaExpedicionFactura>${escapeXml(idf.FechaExpedicionFactura)}</sf:FechaExpedicionFactura>` +
    "</sfR:IDFactura>" +
    operacion +
    (ref !== undefined ? `<sfR:RefExterna>${escapeXml(ref)}</sfR:RefExterna>` : "") +
    "<sfR:EstadoRegistro>Incorrecto</sfR:EstadoRegistro>" +
    "<sfR:CodigoErrorRegistro>3000</sfR:CodigoErrorRegistro>" +
    "<sfR:DescripcionErrorRegistro>Registro duplicado</sfR:DescripcionErrorRegistro>" +
    (estadoDuplicado !== undefined && idPeticion !== undefined
      ? "<sfR:RegistroDuplicado>" +
        `<sf:IdPeticionRegistroDuplicado>${escapeXml(idPeticion)}</sf:IdPeticionRegistroDuplicado>` +
        `<sf:EstadoRegistroDuplicado>${estadoDuplicado}</sf:EstadoRegistroDuplicado>` +
        "</sfR:RegistroDuplicado>"
      : "") +
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

function consultaResponseHeaderXml(cabecera: CabeceraConsulta): string {
  const identity =
    cabecera.ObligadoEmision !== undefined
      ? "<sf:ObligadoEmision>" +
        sfValueXml("NombreRazon", cabecera.ObligadoEmision.NombreRazon) +
        sfValueXml("NIF", cabecera.ObligadoEmision.NIF) +
        "</sf:ObligadoEmision>"
      : "<sf:Destinatario>" +
        sfValueXml("NombreRazon", cabecera.Destinatario.NombreRazon) +
        sfValueXml("NIF", cabecera.Destinatario.NIF) +
        "</sf:Destinatario>";
  return (
    "<sfRC:Cabecera>" +
    sfValueXml("IDVersion", "1.0") +
    identity +
    sfValueXml("IndicadorRepresentante", cabecera.IndicadorRepresentante) +
    "</sfRC:Cabecera>"
  );
}

/** `matches` is the already-paged slice to return; `more` says whether further pages remain beyond it. */
function consultaEnvelope(
  cabecera: CabeceraConsulta,
  filtro: ConsultaFiltro,
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
          ? `<sfRC:RefExterna>${escapeXml(s.refExterna)}</sfRC:RefExterna>`
          : "") +
        (responseOptions?.MostrarSistemaInformatico === "S" && details
          ? sistemaConsultaXml(details.sistema)
          : "") +
        `<sfRC:TipoHuella>01</sfRC:TipoHuella><sfRC:Huella>${escapeXml(s.huella)}</sfRC:Huella>` +
        "</sfRC:DatosRegistroFacturacion>" +
        "<sfRC:EstadoRegistro>" +
        "<sfRC:TimestampUltimaModificacion>2026-07-21T00:00:00+00:00</sfRC:TimestampUltimaModificacion>" +
        `<sfRC:EstadoRegistro>${s.estado}</sfRC:EstadoRegistro>` +
        "</sfRC:EstadoRegistro>" +
        "</sfRC:RegistroRespuestaConsultaFactuSistemaFacturacion>"
      );
    })
    .join("");
  const last = matches[matches.length - 1];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="${NS_SF}" xmlns:sfRC="${NS_RC}"><soapenv:Body>` +
    "<sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    consultaResponseHeaderXml(cabecera) +
    "<sfRC:PeriodoImputacion>" +
    `<sfRC:Ejercicio>${escapeXml(filtro.Ejercicio)}</sfRC:Ejercicio>` +
    `<sfRC:Periodo>${escapeXml(filtro.Periodo)}</sfRC:Periodo>` +
    "</sfRC:PeriodoImputacion>" +
    `<sfRC:IndicadorPaginacion>${more ? "S" : "N"}</sfRC:IndicadorPaginacion>` +
    `<sfRC:ResultadoConsulta>${matches.length > 0 ? "ConDatos" : "SinDatos"}</sfRC:ResultadoConsulta>` +
    registros +
    (more && last ? clavePaginacionXml(last) : "") +
    "</sfRC:RespuestaConsultaFactuSistemaFacturacion>" +
    "</soapenv:Body></soapenv:Envelope>"
  );
}
