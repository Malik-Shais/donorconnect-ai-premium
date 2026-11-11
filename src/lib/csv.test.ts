import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csv formula-injection protection", () => {
  it.each(["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tx", "\rx", "=HYPERLINK(\"http://evil\")"])("neutralises %j", (v) => expect(csvCell(v).replace(/^"/, "")).toMatch(/^'/));
  it("keeps numbers, dates, nulls and ordinary text intact", () => {
    expect(csvCell(-5)).toBe("-5"); expect(csvCell(0.5)).toBe("0.5"); expect(csvCell(null)).toBe(""); expect(csvCell(undefined)).toBe("");
    expect(csvCell("A+")).toBe("A+"); expect(csvCell("Lahore")).toBe("Lahore"); expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
  });
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""'); expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });
  it("treats text that merely looks numeric-negative as text", () => expect(csvCell("-5")).toBe("'-5"));
  it("builds CRLF rows with a BOM", () => expect(toCsv(["a", "b"], [[1, "x"], [2, "=y"]])).toBe("﻿a,b\r\n1,x\r\n2,'=y\r\n"));
});
