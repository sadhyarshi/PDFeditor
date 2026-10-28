// Copies static assets into public/ before dev/build:
//  - pdf.js character maps + standard fonts (CJK text, non-embedded Helvetica/Times)
//  - the Noto font files used by the text tool (shared by the preview and the PDF export)
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_FONT_FILES } from '../src/lib/fonts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nm = resolve(root, 'node_modules');

const pdfjs = resolve(nm, 'pdfjs-dist');
for (const dir of ['cmaps', 'standard_fonts']) {
  const src = resolve(pdfjs, dir);
  if (!existsSync(src)) {
    console.warn(`[assets] pdfjs ${dir} not found – run npm install first`);
    continue;
  }
  mkdirSync(resolve(root, 'public/pdfjs', dir), { recursive: true });
  cpSync(src, resolve(root, 'public/pdfjs', dir), { recursive: true });
}

mkdirSync(resolve(root, 'public/fonts'), { recursive: true });
for (const { pkg, file } of ALL_FONT_FILES) {
  const src = resolve(nm, '@fontsource', pkg, 'files', file);
  if (!existsSync(src)) {
    console.warn(`[assets] font ${file} not found – run npm install first`);
    continue;
  }
  cpSync(src, resolve(root, 'public/fonts', file));
}
