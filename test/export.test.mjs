// Run with: npm test
// Checks the export pipeline (merge / reorder / delete / duplicate / rotate / image placement).
// Image placement is verified by rendering the result with `pdftoppm` (poppler) when it is installed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { buildPdf } from '../src/lib/exportPdf.js';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'pdf-editor-test-'));
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

/* ---------- fixtures ---------- */

// Minimal PNG encoder: top half red, bottom half blue.
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function redBluePng(w = 20, h = 20) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const o = 1 + x * 3;
      if (y < h / 2) row[o] = 255;
      else row[o + 2] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

async function makeSource(sizes, rotations = []) {
  const doc = await PDFDocument.create();
  sizes.forEach(([w, h], i) => {
    const p = doc.addPage([w, h]);
    if (rotations[i]) p.setRotation(degrees(rotations[i]));
  });
  return new Uint8Array(await doc.save());
}

const rec = (srcId, srcIndex, vw, vh, extra = {}) => ({
  id: `p${srcId}-${srcIndex}-${Math.random()}`,
  srcId,
  srcIndex,
  base: 0,
  vw,
  vh,
  rot: 0,
  overlays: [],
  ...extra,
});
const sizeOf = (page) => `${Math.round(page.getWidth())}x${Math.round(page.getHeight())}`;
const hasImage = (page) => {
  const xo = page.node.Resources()?.lookup(PDFName.of('XObject'));
  return !!xo && xo.keys().length > 0;
};

/* ---------- logic tests ---------- */

const A = await makeSource([[300, 400], [301, 401], [302, 402]], [0, 90, 0]);
const B = await makeSource([[612, 792], [613, 793]]);
const sources = new Map([
  [1, { bytes: A }],
  [2, { bytes: B }],
]);
const png = redBluePng();
const jpg = new Uint8Array(readFileSync(join(here, 'fixtures/redblue.jpg')));
const assets = new Map([
  ['png', { bytes: png, mime: 'image/png' }],
  ['jpg', { bytes: jpg, mime: 'image/jpeg' }],
]);

console.log('Export pipeline');

await test('merge, reorder and delete pages', async () => {
  // Order: B2, A1, A3, (A2 deleted), B1
  const pages = [rec(2, 1, 613, 793), rec(1, 0, 300, 400), rec(1, 2, 302, 402), rec(2, 0, 612, 792)];
  const out = await PDFDocument.load(await buildPdf({ pages, sources, assets }));
  assert.deepEqual(out.getPages().map(sizeOf), ['613x793', '300x400', '302x402', '612x792']);
});

await test('blank pages keep the requested size', async () => {
  const pages = [rec(null, 0, 400, 500, { srcId: null }), rec(1, 0, 300, 400)];
  const out = await PDFDocument.load(await buildPdf({ pages, sources, assets }));
  assert.deepEqual(out.getPages().map(sizeOf), ['400x500', '300x400']);
});

await test('a duplicated page is an independent copy', async () => {
  const withImage = rec(1, 0, 300, 400, {
    overlays: [{ id: 'o1', assetId: 'png', fx: 0.1, fy: 0.1, fw: 0.3, fh: 0.2, opacity: 1 }],
  });
  const plain = rec(1, 0, 300, 400);
  const out = await PDFDocument.load(await buildPdf({ pages: [withImage, plain], sources, assets }));
  const [p1, p2] = out.getPages();
  assert.equal(hasImage(p1), true);
  assert.equal(hasImage(p2), false, 'image must not leak onto the duplicate');
});

await test('rotation adds to the source page rotation', async () => {
  const pages = [rec(1, 1, 301, 401, { base: 90, rot: 90 }), rec(1, 0, 300, 400, { rot: 270 })];
  const out = await PDFDocument.load(await buildPdf({ pages, sources, assets }));
  assert.deepEqual(
    out.getPages().map((p) => p.getRotation().angle),
    [180, 270],
  );
});

await test('the same image is embedded once, even when used on several pages', async () => {
  const ov = { id: 'o', assetId: 'png', fx: 0.1, fy: 0.1, fw: 0.3, fh: 0.2, opacity: 1 };
  const pages = [rec(1, 0, 300, 400, { overlays: [ov] }), rec(1, 2, 302, 402, { overlays: [ov] })];
  const bytes = await buildPdf({ pages, sources, assets });
  const out = await PDFDocument.load(bytes);
  const refs = out.getPages().map((p) => {
    const xo = p.node.Resources().lookup(PDFName.of('XObject'));
    return xo.get(xo.keys()[0]).toString();
  });
  assert.equal(refs[0], refs[1]);
});

await test('empty page list is rejected', async () => {
  await assert.rejects(() => buildPdf({ pages: [], sources, assets }), /no pages/i);
});

/* ---------- rendering test ---------- */

let havePoppler = true;
try {
  execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
} catch (e) {
  havePoppler = e.code !== 'ENOENT';
}

function renderFirstPage(pdfBytes, name) {
  const file = join(tmp, `${name}.pdf`);
  writeFileSync(file, pdfBytes);
  const prefix = join(tmp, name);
  execFileSync('pdftoppm', ['-r', '72', '-f', '1', '-l', '1', file, prefix]);
  const ppm = readFileSync(`${prefix}-1.ppm`);
  // P6\nW H\n255\n<data>
  let pos = 0;
  const token = () => {
    while (ppm[pos] <= 32) pos++;
    let s = '';
    while (ppm[pos] > 32) s += String.fromCharCode(ppm[pos++]);
    return s;
  };
  assert.equal(token(), 'P6');
  const w = Number(token());
  const h = Number(token());
  token();
  pos++;
  return { w, h, px: (x, y) => ppm.subarray(pos + (y * w + x) * 3, pos + (y * w + x) * 3 + 3) };
}

// Rotate a rectangle (fractions of a frame, origin top-left) 90 degrees clockwise.
const rotateRectCw = ({ x, y, w, h }) => ({ x: 1 - y - h, y: x, w: h, h: w });

if (!havePoppler) {
  console.log('  --  skipped rendering test (pdftoppm not installed)');
} else {
  console.log('Rendering (poppler)');
  const W = 200;
  const H = 300;
  const f = { fx: 0.1, fy: 0.15, fw: 0.3, fh: 0.2 };

  for (const imageKind of ['png', 'jpg']) {
    const baseRotations = imageKind === 'png' ? [0, 90, 180, 270] : [0];
    for (const base of baseRotations) {
      for (const rot of [0, 90, 180, 270]) {
        await test(`${imageKind} overlay, source /Rotate ${base}, extra rotation ${rot}`, async () => {
          const src = await makeSource([[W, H]], [base]);
          const page = rec(1, 0, base % 180 ? H : W, base % 180 ? W : H, {
            base,
            rot,
            overlays: [{ id: 'o', assetId: imageKind, opacity: 1, ...f }],
          });
          const bytes = await buildPdf({ pages: [page], sources: new Map([[1, { bytes: src }]]), assets });
          const img = renderFirstPage(bytes, `${imageKind}-${base}-${rot}`);

          // Expected rectangle in the final picture.
          let r = { x: f.fx, y: f.fy, w: f.fw, h: f.fh };
          for (let i = 0; i < rot / 90; i++) r = rotateRectCw(r);
          const exp = { x0: r.x * img.w, y0: r.y * img.h, x1: (r.x + r.w) * img.w, y1: (r.y + r.h) * img.h };

          // Bounding box of coloured (non-white) pixels.
          let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
          for (let y = 0; y < img.h; y++) {
            for (let x = 0; x < img.w; x++) {
              const [R, G, B2] = img.px(x, y);
              if (Math.min(R, G, B2) < 128) {
                x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
              }
            }
          }
          const tol = 3;
          assert.ok(
            Math.abs(x0 - exp.x0) <= tol && Math.abs(y0 - exp.y0) <= tol && Math.abs(x1 - exp.x1) <= tol && Math.abs(y1 - exp.y1) <= tol,
            `position: got [${x0},${y0},${x1},${y1}] expected [${exp.x0.toFixed(1)},${exp.y0.toFixed(1)},${exp.x1.toFixed(1)},${exp.y1.toFixed(1)}]`,
          );

          // Orientation: the image's red half starts on the top edge and turns with the page.
          const cx = (exp.x0 + exp.x1) / 2;
          const cy = (exp.y0 + exp.y1) / 2;
          const dx = (exp.x1 - exp.x0) / 4;
          const dy = (exp.y1 - exp.y0) / 4;
          const side = [[0, -dy], [dx, 0], [0, dy], [-dx, 0]][(rot / 90) % 4]; // direction of the image's top
          const topPx = img.px(Math.round(cx + side[0]), Math.round(cy + side[1]));
          const botPx = img.px(Math.round(cx - side[0]), Math.round(cy - side[1]));
          assert.ok(topPx[0] > 200 && topPx[2] < 80, `image top should be red, got rgb(${[...topPx]})`);
          assert.ok(botPx[2] > 200 && botPx[0] < 80, `image bottom should be blue, got rgb(${[...botPx]})`);
        });
      }
    }
  }
}

console.log(`\n${passed} checks passed`);
