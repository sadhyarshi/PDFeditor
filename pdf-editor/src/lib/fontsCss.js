// Browser side of the fonts: @font-face rules for the preview and a byte loader for the exporter.
import { DEVA, FAMILIES, fontFileName } from './fonts.js';

const base = () => new URL(`${import.meta.env.BASE_URL}fonts/`, window.location.href).href;

export function injectFonts() {
  const url = base();
  const rules = [];
  const add = (font) => {
    for (const style of font.styles) {
      const [weight, shape] = style.split('-');
      rules.push(
        `@font-face{font-family:'${font.css}';font-style:${shape};font-weight:${weight};font-display:swap;` +
          `src:url('${url}${fontFileName(font, style)}') format('woff');}`,
      );
    }
  };
  Object.values(FAMILIES).forEach(add);
  add(DEVA);
  const el = document.createElement('style');
  el.dataset.pdfEditorFonts = '';
  el.textContent = rules.join('\n');
  document.head.appendChild(el);
}

const cache = new Map();

/** Used by the exporter: fetches a font file once. */
export function loadFont(file) {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(`${base()}${file}`).then(async (res) => {
        if (!res.ok) throw new Error(`Could not load font ${file}`);
        return new Uint8Array(await res.arrayBuffer());
      }),
    );
  }
  return cache.get(file);
}
