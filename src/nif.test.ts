import { describe, expect, it } from "vitest";
import { hasValidNifControl } from "./nif.js";

describe("hasValidNifControl", () => {
  it.each(["00000000T", "X0000000T", "K0000000T", "K12AB34QZ", "B00000000"])(
    "requires the whole %s identifier, not a matching substring",
    (valid) => {
      expect(hasValidNifControl(valid)).toBe(true);
      expect(hasValidNifControl(`!${valid}`)).toBe(false);
      expect(hasValidNifControl(`${valid}!`)).toBe(false);
    },
  );

  it("rejects a letter where the company class requires a digit", () => {
    expect(hasValidNifControl("B00000000")).toBe(true);
    expect(hasValidNifControl("B0000000J")).toBe(false);
  });
});
