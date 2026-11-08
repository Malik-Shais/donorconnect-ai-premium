import { describe, expect, it } from "vitest";
import { canGiveTo, canReceiveFrom, GROUPS } from "./compat";

describe("blood group compatibility", () => {
  it("O- gives to everyone and only receives from O-", () => {
    expect(canGiveTo("O-")).toHaveLength(8);
    expect(canReceiveFrom("O-")).toEqual(["O-"]);
  });
  it("AB+ receives from everyone", () => expect(canReceiveFrom("AB+")).toEqual([...GROUPS]));
  it("is symmetric: d gives to r  <=>  r receives from d", () => {
    for (const d of GROUPS) for (const r of GROUPS) expect(canGiveTo(d).includes(r)).toBe(canReceiveFrom(r).includes(d));
  });
});
