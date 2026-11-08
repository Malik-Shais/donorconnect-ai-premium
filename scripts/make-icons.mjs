// Renders PWA PNG icons from SVG using the pre-installed Chromium. Run: node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
const drop = `<path d="M32 12C42 25 49 32 49 41a17 17 0 0 1-34 0C15 32 22 25 32 12z" fill="url(#g)"/>`;
const svg = (bg, rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b5b"/><stop offset="1" stop-color="#7a1630"/></linearGradient></defs><rect width="64" height="64" rx="${rx}" fill="${bg}"/>${drop}</svg>`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [name, size, bg, rx] of [["icon-192", 192, "#faf6f1", 14], ["icon-512", 512, "#faf6f1", 14], ["maskable-512", 512, "#faf6f1", 0]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0">${svg(bg, rx).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
  await p.screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
}
await b.close();
