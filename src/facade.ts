import { createClient, type ClientOptions } from "./client.js";
import { buildAltaRecord } from "./records.js";
import {
  isAlta,
  type AltaInput,
  type RegistroAlta,
  type RegistroAnterior,
  type RegistroAnulacion,
} from "./types.js";
import type { RespuestaSuministro } from "./xml/parse-suministro.js";
import type { Cabecera, EnvioRegistro } from "./xml/serialize.js";

/** The caller supplies the next invoice number and any persisted predecessor. */
export type BuildAltaInput = Omit<AltaInput, "Encadenamiento"> & {
  previous: RegistroAnterior | null;
};

export function buildAlta({ previous, ...input }: BuildAltaInput): RegistroAlta {
  if (previous === undefined) {
    throw new TypeError("previous must be null for the first record or a persisted predecessor");
  }
  return buildAltaRecord({
    ...input,
    Encadenamiento: previous === null ? { PrimerRegistro: "S" } : { RegistroAnterior: previous },
  });
}

/** Submits records in caller-supplied order; the caller owns chain state and retries. */
export function submitRecords(
  options: ClientOptions,
  cabecera: Cabecera,
  records: Array<RegistroAlta | RegistroAnulacion>,
): Promise<RespuestaSuministro> {
  const registros: EnvioRegistro[] = records.map((record) =>
    isAlta(record) ? { RegistroAlta: record } : { RegistroAnulacion: record },
  );
  return createClient(options).submit(cabecera, registros);
}
