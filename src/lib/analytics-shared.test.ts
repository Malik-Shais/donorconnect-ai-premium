import { describe, expect, it } from "vitest";
import { defaultFilters, filterQuery, hours, parseFilters, pct } from "@/lib/analytics-shared";

describe("parseFilters (untrusted query input)", () => {
  it("defaults to the last 90 days", () => { const { filters, error } = parseFilters({}, true); expect(error).toBeUndefined(); expect(filters).toEqual(defaultFilters()); });
  it("accepts a valid selection", () => expect(parseFilters({ from: "2026-01-01", to: "2026-02-01", city: "Lahore", group: "O+", scope: "demo" }, true).filters)
    .toEqual({ from: "2026-01-01", to: "2026-02-01", city: "Lahore", group: "O+", scope: "demo" }));
  it.each([
    [{ from: "2026-13-01" }, /valid date/], [{ from: "2026-02-30" }, /valid date/], [{ from: "yesterday" }, /./], [{ from: "2026-05-01", to: "2026-04-01" }, /start date/],
    [{ from: "2000-01-01", to: "2026-01-01" }, /5 years/], [{ group: "Z+" }, /./], [{ city: "x'; drop table--" }, /unsupported/], [{ city: "a".repeat(61) }, /./], [{ scope: "everything" }, /./],
  ])("rejects %j without touching SQL", (sp, msg) => { const r = parseFilters(sp as Record<string, string>, true); expect(r.error).toMatch(msg); expect(r.filters).toEqual(defaultFilters()); });
  it("ignores `scope` for non-administrators", () => expect(parseFilters({ scope: "demo" }, false).filters.scope).toBe("all"));
  it("takes the first value of a repeated parameter", () => expect(parseFilters({ group: ["A+", "B+"] }, false).filters.group).toBe("A+"));
});
describe("formatting and query building", () => {
  it("null rates and durations render as an em dash, never 0 or NaN", () => { expect(pct(null)).toBe("—"); expect(hours(null)).toBe("—"); expect(pct(0)).toBe("0%"); expect(pct(0.6667)).toBe("66.7%"); });
  it("durations pick a readable unit", () => { expect(hours(0.5)).toBe("30 min"); expect(hours(4.5)).toBe("4.5 h"); expect(hours(72)).toBe("3 d"); });
  it("filterQuery omits empty filters and encodes values", () => expect(filterQuery({ from: "2026-01-01", to: "2026-02-01", city: "St. John's", group: "", scope: "all" }, { page: 2 })).toBe("from=2026-01-01&to=2026-02-01&city=St.+John%27s&page=2"));
});
