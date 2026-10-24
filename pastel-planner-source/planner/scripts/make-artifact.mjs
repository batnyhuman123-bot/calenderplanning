// Converts the single-file Vite build into a page body for hosting as a Claude artifact
// (the host supplies <!doctype>, <html>, <head> and <body>). Output: dist/artifact.html
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('No inline module script found in dist/index.html');
const out = `<title>Pastel Planner</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap">
<style>${styles}</style>
<div id="root"></div>
<script type="module">${scripts.join('\n')}</script>
`;
// Escape literal U+FFFD (appears inside library string/regex literals) so the page is plain-ASCII-safe.
const safe = out.replace(/\uFFFD/g, "\\uFFFD");
writeFileSync("dist/artifact.html", safe);
console.log(`dist/artifact.html written (${(out.length / 1024).toFixed(0)} KB)`);
