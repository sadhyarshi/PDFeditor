// Copies pdf.js character maps and standard fonts into public/ so PDFs that
// rely on them (CJK text, non-embedded Helvetica/Times) render correctly.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/pdfjs-dist');
const to = resolve(root, 'public/pdfjs');

for (const dir of ['cmaps', 'standard_fonts']) {
  const src = resolve(from, dir);
  if (!existsSync(src)) {
    console.warn(`[pdfjs-assets] ${dir} not found – run npm install first`);
    continue;
  }
  mkdirSync(resolve(to, dir), { recursive: true });
  cpSync(src, resolve(to, dir), { recursive: true });
}
