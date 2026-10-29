# PDF Editor

A browser-based PDF editor built with React + Vite. Everything runs on the client, so files are never uploaded.

## Features

| Feature | How |
| --- | --- |
| **Merge** | Add several PDFs (button or drag & drop). Pages are appended; reorder them afterwards. |
| **Reorder** | Drag thumbnails, or use the up/down (left/right in grid view) buttons. Works on multi-selections. |
| **Delete** | Select pages, press the Delete button or the `Delete` key. |
| **Insert image on a page** | `Insert image` → the image appears on the current page. Drag to move, drag a corner to resize (aspect ratio locked), opacity slider, `Remove image`. |
| **Add text** | `Add text` → a text box appears on the current page, ready to type. Press `Esc` (or click away) to finish; double-click a box to edit it again; drag to move. The bar above the page sets font (Sans / Serif / Mono), size, bold, italic, alignment, colour and opacity. Hindi / Devanagari and `₹` work automatically. |
| **Cover existing content** | `Cover` adds a coloured box (white by default) you can move and resize. Put it over old text, then type the new text on top. This is how you "edit" text that is already in a PDF. |
| **Images as pages** | Drop PNG/JPEG/WebP/GIF/SVG files anywhere; each becomes its own page. |
| Rotate, duplicate, blank page | Action bar. Works on the selection. |
| Save selection only | Select some pages, then `Save n selected`. |
| Undo / redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`. Moving an image counts as one step. |
| Views | **Editor** (thumbnails + large preview) or **All pages** (grid for easy reordering). |

Selecting pages: click, `Ctrl/Cmd`-click to add, `Shift`-click for a range, `Ctrl/Cmd+A` for all, or use the round check on each thumbnail. Double-click a thumbnail in the grid to open it.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (host anywhere)
npm test           # export pipeline tests (needs poppler's pdftoppm for the rendering checks; they are skipped without it)
```

Node 18+ is required.

## How it works

- **pdf.js** (`pdfjs-dist`) only *displays* pages (thumbnails and the preview).
- **pdf-lib** builds the output PDF: `copyPages` for merge/reorder/delete, `drawImage` for inserted images, `setRotation` for rotation.
- The editor keeps a simple list of page records (`src/App.jsx`). Nothing is written to the PDF until you download, so undo/redo is just swapping lists (`src/lib/history.js`).
- Image positions are stored as fractions of the page, measured on the page *as displayed*. `overlayPlacement()` in `src/lib/exportPdf.js` converts them to PDF coordinates for pages that have their own `/Rotate` value.
- Text is embedded as real, selectable text with subset fonts (the same Noto font files are used for the preview and for the PDF, so line breaks and positions match). Hindi shaping is done by `@pdf-lib/fontkit`.
- Images that pdf-lib cannot embed (WebP, GIF, SVG…) are converted to PNG in the browser. Phone photos with EXIF rotation are re-encoded so they are not sideways.

```
src/
  App.jsx               state, page operations, drag & drop, export
  components/           Viewer (preview + image editing), Thumb, PageFrame, EmptyState, Icon
  lib/exportPdf.js      builds the final PDF (no DOM, covered by tests)
  lib/pdfjs.js          page rendering
  lib/image.js          image preparation
  lib/fonts.js          font catalogue + script splitting (shared by preview and export)
  lib/fontsCss.js       @font-face rules and font loading for the browser
  lib/history.js        undo/redo reducer
test/export.test.mjs    merge/reorder/delete/rotate, images, text and cover boxes on every page rotation (rendered with poppler)
```

## Limitations

- **Encrypted / password-protected PDFs** are rejected with a message (pdf-lib cannot decrypt them).
- Interactive **form fields** are not carried over when pages are copied. Links and visual content are.
- Inserted images are flattened into the page: after download they are normal page content, not editable objects. Keep working in the editor until you are done.
- Large PDFs (hundreds of pages / hundreds of MB) depend on the browser's memory. Thumbnails render progressively.
- **Existing text cannot be edited in place.** PDFs do not store text as editable paragraphs, so changing it means covering it (`Cover`) and typing over it. Covered text is hidden, **not removed**: it can still be selected or copied from the file, so do not use this to redact secrets.
- Text boxes support Latin and Devanagari scripts (Noto Sans / Serif / Mono, bundled). Other scripts (Chinese, Arabic, emoji…) will show missing-glyph boxes; add more fonts in `src/lib/fonts.js`.
- Text boxes have no automatic wrapping: press Enter for a new line. This keeps the editor and the exported PDF identical.

## Fonts

Noto Sans, Noto Serif, Noto Sans Mono and Noto Sans Devanagari come from the `@fontsource/*` packages and are licensed under the SIL Open Font License. `npm run dev` / `npm run build` copy the needed files into `public/fonts/`.
