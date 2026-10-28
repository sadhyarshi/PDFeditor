// Font catalogue shared by the preview (CSS) and the exporter (pdf-lib).
// Both use the SAME Noto font files, so text looks and wraps the same in the editor and in the PDF.
// No DOM access here: the build script and the Node tests import this file too.

export const LINE_HEIGHT = 1.25; // multiple of the font size

const FOUR = ['400-normal', '700-normal', '400-italic', '700-italic'];

export const FAMILIES = {
  sans: { label: 'Sans', css: 'PDFE Sans', pkg: 'noto-sans', subset: 'latin', styles: FOUR },
  serif: { label: 'Serif', css: 'PDFE Serif', pkg: 'noto-serif', subset: 'latin', styles: FOUR },
  mono: { label: 'Mono', css: 'PDFE Mono', pkg: 'noto-sans-mono', subset: 'latin', styles: ['400-normal', '700-normal'] },
};

// Used automatically for Devanagari (Hindi, Marathi, Sanskrit…), the rupee sign and similar.
export const DEVA = {
  css: 'PDFE Deva',
  pkg: 'noto-sans-devanagari',
  subset: 'devanagari',
  styles: ['400-normal', '700-normal'],
};

export const fontFileName = (font, style) => `${font.pkg}-${font.subset}-${style}.woff`;

/** Picks the closest available style ("700-italic" → "700-normal" for fonts without italics). */
export function styleKey(font, bold, italic) {
  const weight = bold ? '700' : '400';
  const key = `${weight}-${italic ? 'italic' : 'normal'}`;
  return font.styles.includes(key) ? key : `${weight}-normal`;
}

export const hasItalic = (familyKey) => FAMILIES[familyKey]?.styles.includes('400-italic') ?? false;

/** CSS font stack: the chosen family first, Devanagari as the per-character fallback. */
export const fontStack = (familyKey) => `'${(FAMILIES[familyKey] ?? FAMILIES.sans).css}', '${DEVA.css}', sans-serif`;

export const ALL_FONT_FILES = [
  ...Object.values(FAMILIES).flatMap((f) => f.styles.map((s) => ({ pkg: f.pkg, file: fontFileName(f, s) }))),
  ...DEVA.styles.map((s) => ({ pkg: DEVA.pkg, file: fontFileName(DEVA, s) })),
];

const isDevaCp = (cp) =>
  (cp >= 0x0900 && cp <= 0x097f) ||
  (cp >= 0x1cd0 && cp <= 0x1cf9) ||
  (cp >= 0xa8e0 && cp <= 0xa8ff) ||
  cp === 0x20a8 || // ₨
  cp === 0x20b9 || // ₹
  cp === 0x25cc;

/** Splits a line into runs that each use one font: { text, deva }. Spaces always use the main font. */
export function splitRuns(line) {
  const runs = [];
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const joiner = cp === 0x200c || cp === 0x200d; // keeps its neighbour's run so conjuncts form
    const deva = joiner && runs.length ? runs[runs.length - 1].deva : isDevaCp(cp);
    const last = runs[runs.length - 1];
    if (last && last.deva === deva) last.text += ch;
    else runs.push({ text: ch, deva });
  }
  return runs;
}
