// Builds the final PDF with pdf-lib. No DOM access here, so it can be tested in Node.
//
// Page record:
//   { id, srcId|null, srcIndex, base, vw, vh, rot, overlays: [...] }
//   srcId === null  -> blank page of size vw x vh points
//   base            -> the source page's own /Rotate (degrees)
//   rot             -> extra clockwise rotation chosen by the user
//
// Overlays (added by the user). Positions are fractions of the page *as it looks at rotation
// `base`*, measured from its top-left corner:
//   image  { kind?: 'image', assetId, fx, fy, fw, fh, opacity }
//   rect   { kind: 'rect', fx, fy, fw, fh, color, opacity }                       ("cover" box)
//   text   { kind: 'text', text, fx, fy, size(pt), family, bold, italic, align, color, opacity }
// fontkit's Indic (Hindi) shaper is compiled with generators and expects this global.
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { DEVA, FAMILIES, LINE_HEIGHT, fontFileName, splitRuns, styleKey } from './fonts.js';

const norm = (a) => ((a % 360) + 360) % 360;

function hexColor(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(value || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Size of the page as the user sees it at rotation `base`. */
const visibleSize = (base, box) =>
  base % 180 !== 0 ? { visW: box.height, visH: box.width } : { visW: box.width, visH: box.height };

/**
 * Maps a point of the visible page (points, origin top-left, y down) to PDF user space.
 * `angle` is the counter-clockwise rotation to give drawn objects so they stay upright.
 */
export function visibleToPdf(base, box, vx, vy) {
  const W = box.width;
  const H = box.height;
  let x;
  let y;
  switch (base) {
    case 90:
      x = vy;
      y = vx;
      break;
    case 180:
      x = W - vx;
      y = vy;
      break;
    case 270:
      x = W - vy;
      y = H - vx;
      break;
    default:
      x = vx;
      y = H - vy;
  }
  return { x: box.x + x, y: box.y + y, angle: base };
}

/** Converts a rectangle (fractions of the visible page) into drawImage/drawRectangle arguments. */
export function overlayPlacement(base, box, f) {
  const { visW, visH } = visibleSize(base, box);
  const vw = f.fw * visW;
  const vh = f.fh * visH;
  // the rectangle's bottom-left corner
  const p = visibleToPdf(base, box, f.fx * visW, f.fy * visH + vh);
  return { x: p.x, y: p.y, width: vw, height: vh, angle: p.angle };
}

export async function buildPdf({ pages, sources, assets, loadFont }) {
  if (!pages.length) throw new Error('There are no pages to export');

  const out = await PDFDocument.create();

  const srcDocs = new Map();
  const loadSource = async (srcId) => {
    if (!srcDocs.has(srcId)) {
      const src = sources.get(srcId);
      if (!src) throw new Error('A source file is missing');
      srcDocs.set(srcId, await PDFDocument.load(src.bytes, { updateMetadata: false }));
    }
    return srcDocs.get(srcId);
  };

  // copyPages() shares resources (fonts, images) inside ONE call, so we copy each source's
  // pages in as few calls as possible. A page used twice needs a second, separate copy
  // because we edit every copy independently – hence the "occurrence" batches.
  const seen = new Map();
  const batches = new Map();
  const slots = [];
  pages.forEach((p, i) => {
    if (p.srcId == null) return;
    const key = `${p.srcId}:${p.srcIndex}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const batchKey = `${p.srcId}#${occurrence}`;
    if (!batches.has(batchKey)) batches.set(batchKey, { srcId: p.srcId, indices: [] });
    const batch = batches.get(batchKey);
    if (!batch.indices.includes(p.srcIndex)) batch.indices.push(p.srcIndex);
    slots[i] = { batchKey, srcIndex: p.srcIndex };
  });

  const copied = new Map();
  for (const [batchKey, batch] of batches) {
    const doc = await loadSource(batch.srcId);
    const result = await out.copyPages(doc, batch.indices);
    copied.set(batchKey, new Map(batch.indices.map((idx, j) => [idx, result[j]])));
  }

  const embedded = new Map();
  const embedImage = async (assetId) => {
    if (!embedded.has(assetId)) {
      const asset = assets.get(assetId);
      if (!asset) throw new Error('An inserted image is missing');
      embedded.set(
        assetId,
        asset.mime === 'image/jpeg' ? await out.embedJpg(asset.bytes) : await out.embedPng(asset.bytes),
      );
    }
    return embedded.get(assetId);
  };

  // Fonts: embedded (subset) only when a text box needs them.
  let fontkitRegistered = false;
  const fonts = new Map();
  const getFont = async (file) => {
    if (!fonts.has(file)) {
      if (!loadFont) throw new Error('Fonts are not available for the text boxes');
      if (!fontkitRegistered) {
        out.registerFontkit(fontkit);
        fontkitRegistered = true;
      }
      const bytes = await loadFont(file);
      const metrics = fontkit.create(bytes);
      fonts.set(file, {
        pdf: await out.embedFont(bytes, { subset: true }),
        asc: metrics.ascent / metrics.unitsPerEm,
        desc: -metrics.descent / metrics.unitsPerEm,
      });
    }
    return fonts.get(file);
  };

  const drawTextBox = async (page, base, box, o) => {
    const family = FAMILIES[o.family] ?? FAMILIES.sans;
    const latinFile = fontFileName(family, styleKey(family, o.bold, o.italic));
    const devaFile = fontFileName(DEVA, styleKey(DEVA, o.bold, false));
    const size = o.size || 16;
    const lineHeight = size * LINE_HEIGHT;
    const color = hexColor(o.color);
    const primary = await getFont(latinFile);
    const { visW, visH } = visibleSize(base, box);

    const lines = [];
    for (const line of String(o.text ?? '').split('\n')) {
      const runs = [];
      let width = 0;
      for (const run of splitRuns(line)) {
        const font = await getFont(run.deva ? devaFile : latinFile);
        const w = font.pdf.widthOfTextAtSize(run.text, size);
        runs.push({ text: run.text, font: font.pdf, width: w });
        width += w;
      }
      lines.push({ runs, width });
    }
    const boxWidth = Math.max(0, ...lines.map((l) => l.width));
    const left = o.fx * visW;
    const top = o.fy * visH;

    lines.forEach((line, i) => {
      let x = left;
      if (o.align === 'center') x += (boxWidth - line.width) / 2;
      else if (o.align === 'right') x += boxWidth - line.width;
      // Same placement as CSS: the line box is `lineHeight` tall, the glyphs are centred in it.
      const baseline = top + i * lineHeight + (lineHeight - (primary.asc + primary.desc) * size) / 2 + primary.asc * size;
      for (const run of line.runs) {
        if (run.text.trim()) {
          const p = visibleToPdf(base, box, x, baseline);
          page.drawText(run.text, {
            x: p.x,
            y: p.y,
            size,
            font: run.font,
            color,
            rotate: degrees(p.angle),
            opacity: o.opacity ?? 1,
          });
        }
        x += run.width;
      }
    });
  };

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let page;
    let base = 0;
    let box;

    if (p.srcId == null) {
      page = out.addPage([p.vw, p.vh]);
      box = { x: 0, y: 0, width: p.vw, height: p.vh };
    } else {
      page = copied.get(slots[i].batchKey).get(slots[i].srcIndex);
      base = norm(page.getRotation().angle);
      out.addPage(page);
      box = page.getCropBox();
    }

    for (const o of p.overlays ?? []) {
      const kind = o.kind ?? 'image';
      if (kind === 'text') {
        if (String(o.text ?? '').trim()) await drawTextBox(page, base, box, o);
      } else if (kind === 'rect') {
        const r = overlayPlacement(base, box, o);
        page.drawRectangle({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          rotate: degrees(r.angle),
          color: hexColor(o.color || '#ffffff'),
          opacity: o.opacity ?? 1,
          borderWidth: 0,
        });
      } else {
        const image = await embedImage(o.assetId);
        const r = overlayPlacement(base, box, o);
        page.drawImage(image, {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          rotate: degrees(r.angle),
          opacity: o.opacity ?? 1,
        });
      }
    }

    page.setRotation(degrees(norm(base + (p.rot ?? 0))));
  }

  return out.save();
}
