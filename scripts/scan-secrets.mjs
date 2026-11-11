// Fails when a tracked file looks like it contains a real secret. Cheap, dependency-free, deterministic (CI and pre-push).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, "private key"],
  [/\bsk-[A-Za-z0-9]{32,}/, "secret-style API key"],
  [/postgres(ql)?:\/\/[^:\s/@]+:(?!<|\$|\{|password|pw|\*\*)[^@\s]{8,}@(?!127\.0\.0\.1|localhost)/, "database URL with a password for a non-local host"],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT (check it is not a service_role/secret token)"],
];
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter((f) => f && !/^(legacy\/|package-lock\.json$|public\/icons\/|docs\/.*\.png$)/.test(f));
let bad = 0;
for (const f of files) {
  let text; try { text = readFileSync(f, "utf8"); } catch { continue; }
  if (text.includes("\0")) continue;
  for (const [re, what] of RULES) if (re.test(text)) { console.error(`${f}: possible ${what}`); bad++; } // the matched text is never printed
}
if (bad) { console.error(`\n${bad} possible secret(s) in tracked files.`); process.exit(1); }
console.log(`secret scan: ${files.length} tracked files clean`);
