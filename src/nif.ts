const PERSONAL_CONTROL = "TRWAGMYFPDXBNJZSQVHLCKE";
const ENTITY_CONTROL = "JABCDEFGHI";

function personalLetter(digits: string): string {
  return PERSONAL_CONTROL[Number(digits) % 23]!;
}

function entityControl(digits: string): { digit: string; letter: string } {
  let sum = 0;
  for (const [index, character] of [...digits].entries()) {
    const digit = Number(character);
    if (index % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  const value = (10 - (sum % 10)) % 10;
  return { digit: String(value), letter: ENTITY_CONTROL[value]! };
}

/** Checks Spanish tax ID form and locally derivable control characters. */
export function hasValidNifControl(value: string): boolean {
  const dni = /^(\d{8})([A-Z])$/.exec(value);
  if (dni) return dni[2] === personalLetter(dni[1]!);

  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(value);
  if (nie) {
    const prefix = { X: "0", Y: "1", Z: "2" }[nie[1] as "X" | "Y" | "Z"];
    return nie[3] === personalLetter(prefix + nie[2]);
  }

  const numericTaxAssigned = /^[KLM](\d{7})([A-Z])$/.exec(value);
  if (numericTaxAssigned) return numericTaxAssigned[2] === personalLetter(numericTaxAssigned[1]!);

  // AEAT permits seven alphanumeric body characters for K/L/M. Their newer
  // alphabetic-body control cannot be derived from the published numeric rule.
  if (/^[KLM][A-Z0-9]{7}[A-Z]$/.test(value)) return true;

  const entity = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(value);
  if (!entity) return false;
  const control = entityControl(entity[2]!);
  if ("ABEH".includes(entity[1]!)) return entity[3] === control.digit;
  if ("NPQRSW".includes(entity[1]!)) return entity[3] === control.letter;
  return entity[3] === control.digit || entity[3] === control.letter;
}
