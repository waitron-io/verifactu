import { verifyHuella } from "./huella.js";
import { isAlta, type RegistroAlta, type RegistroAnulacion } from "./types.js";
import { parseFechaHoraHusoGenRegistro } from "./validate.js";

type ChainRecord = RegistroAlta | RegistroAnulacion;

export type ChainIssueCode =
  | "HUELLA_MISMATCH"
  | "PREDECESSOR_MISSING"
  | "PREDECESSOR_IDENTITY_MISMATCH"
  | "PREDECESSOR_HUELLA_MISMATCH"
  | "CHAIN_START_UNEXPECTED"
  | "FECHA_HORA_FORMAT"
  | "GENERATION_TIME_ORDER";

export interface ChainIssue {
  /** Zero-based position in records; -1 identifies options.predecessor. */
  recordIndex: number;
  code: ChainIssueCode;
  /** Field on the identified record that failed the check. */
  field: string;
}

export interface ChainCheckOptions {
  /**
   * The actual record immediately before a partial segment, not just its pointer.
   * Its own hash and time are checked, but its earlier ancestry is not checked.
   */
  predecessor?: ChainRecord;
}

export interface ChainCheckResult {
  /**
   * "complete" means the supplied array starts at PrimerRegistro without an
   * external boundary. It does not prove that your storage has no missing tail.
   * "partial" never certifies the boundary's ancestry, even with no issues.
   * An empty array checks nothing, including any supplied predecessor.
   * Scope describes the input coverage; read issues to find failed checks.
   */
  scope: "complete" | "partial" | "empty";
  issues: ChainIssue[];
}

/**
 * Check typed records in the generation order you supply, without changing them.
 *
 * Hashes use verifyHuella's existing rules and cover only the hashed fields.
 * Predecessor identities and hashes are compared literally, without trimming.
 * Times use validate's numeric-offset format and real calendar checks, including
 * 24:00:00; equal instants are allowed. No current-clock comparison is made.
 *
 * Supply options.predecessor when the first record points outside the array;
 * otherwise PREDECESSOR_MISSING reports the unchecked boundary. This does not
 * replace schema/business validation, select your taxpayer/software boundaries,
 * prove authenticity or AEAT acceptance, or decide whether to continue issuance.
 */
export function checkChain(
  records: readonly ChainRecord[],
  options: ChainCheckOptions = {},
): ChainCheckResult {
  const issues: ChainIssue[] = [];
  const first = records[0];
  if (first === undefined) return { scope: "empty", issues };
  const scope =
    options.predecessor === undefined && first.Encadenamiento.PrimerRegistro === "S"
      ? "complete"
      : "partial";
  const add = (recordIndex: number, code: ChainIssueCode, field: string) => {
    issues.push({ recordIndex, code, field });
  };
  const checkRecord = (record: ChainRecord, index: number) => {
    if (!verifyHuella(record)) add(index, "HUELLA_MISMATCH", "Huella");
    const time = parseFechaHoraHusoGenRegistro(record.FechaHoraHusoGenRegistro);
    if (time === undefined) add(index, "FECHA_HORA_FORMAT", "FechaHoraHusoGenRegistro");
    return time?.instant;
  };

  let previous = options.predecessor;
  let previousTime = previous === undefined ? undefined : checkRecord(previous, -1);
  records.forEach((record, index) => {
    const time = checkRecord(record, index);
    const pointer = record.Encadenamiento.RegistroAnterior;
    if (previous === undefined) {
      if (pointer !== undefined) {
        add(index, "PREDECESSOR_MISSING", "Encadenamiento.RegistroAnterior");
      }
    } else {
      if (pointer === undefined) {
        add(index, "CHAIN_START_UNEXPECTED", "Encadenamiento.PrimerRegistro");
      } else {
        const identity = isAlta(previous)
          ? previous.IDFactura
          : {
              IDEmisorFactura: previous.IDFactura.IDEmisorFacturaAnulada,
              NumSerieFactura: previous.IDFactura.NumSerieFacturaAnulada,
              FechaExpedicionFactura: previous.IDFactura.FechaExpedicionFacturaAnulada,
            };
        for (const field of [
          "IDEmisorFactura",
          "NumSerieFactura",
          "FechaExpedicionFactura",
        ] as const) {
          if (pointer[field] !== identity[field]) {
            add(index, "PREDECESSOR_IDENTITY_MISMATCH", `Encadenamiento.RegistroAnterior.${field}`);
          }
        }
        if (pointer.Huella !== previous.Huella) {
          add(index, "PREDECESSOR_HUELLA_MISMATCH", "Encadenamiento.RegistroAnterior.Huella");
        }
      }
      if (time !== undefined && previousTime !== undefined && time < previousTime) {
        add(index, "GENERATION_TIME_ORDER", "FechaHoraHusoGenRegistro");
      }
    }
    previous = record;
    previousTime = time;
  });
  return { scope, issues };
}
