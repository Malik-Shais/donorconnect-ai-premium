import Link from "next/link";
import type { ReactNode } from "react";

// Model output is UNTRUSTED. It is rendered ONLY through React elements (never as HTML), with exactly two inline features:
// **bold** and [label](/dashboard/...) links to internal dashboard pages. Every other link or markup stays inert plain text.
const TOKEN = /(\*\*[^*\n]{1,120}\*\*|\[[^\]\n]{1,80}\]\(\/dashboard\/[A-Za-z0-9/_-]{0,80}\))/g;

export function inline(line: string): ReactNode[] {
  return line.split(TOKEN).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const m = /^\[([^\]]+)\]\((\/dashboard\/[A-Za-z0-9/_-]*)\)$/.exec(part);
    return m ? <Link key={i} href={m[2]} className="font-semibold text-teal underline">{m[1]}</Link> : part;
  });
}

export function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={i} className="my-1 list-disc pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
        return <p key={i} className="my-1 whitespace-pre-wrap break-words">{inline(b)}</p>;
      })}
    </>
  );
}
