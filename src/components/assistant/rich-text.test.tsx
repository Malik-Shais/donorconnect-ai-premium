import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "@/components/assistant/rich-text";

const html = (t: string) => renderToStaticMarkup(<RichText text={t} />);
describe("RichText renders untrusted model output safely", () => {
  it("never emits raw HTML, scripts or external links", () => {
    const out = html('<img src=x onerror=alert(1)> <script>alert(1)</script> [evil](https://evil.example) [js](javascript:alert(1)) [x](//evil.example)');
    expect(out).not.toMatch(/<img|<script|href="https|href="javascript|href="\/\/evil/);
    expect(out).toContain("&lt;script&gt;");
  });
  it("supports bold, bullet lists and internal dashboard links only", () => {
    const out = html("**Hi** there\n\n- one\n- two\n\nSee [Opportunities](/dashboard/donor/opportunities)");
    expect(out).toContain("<strong>Hi</strong>"); expect(out).toContain("<li>one</li>"); expect(out).toContain('href="/dashboard/donor/opportunities"');
  });
});
