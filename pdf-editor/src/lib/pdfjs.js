// Thin wrapper around pdf.js – used only for *displaying* pages.
// Editing/exporting is done with pdf-lib (see exportPdf.js).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;

/** Opens a PDF for rendering. pdf.js transfers the buffer to its worker, so we hand it a copy. */
export function openPdf(bytes) {
  return pdfjsLib.getDocument({
    data: bytes.slice(),
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`,
  }).promise;
}

/**
 * Renders a page into an offscreen canvas.
 * Returns { promise -> canvas | null, cancel() }.
 */
export function renderPage(doc, pageNumber, targetPxWidth) {
  let task = null;
  let cancelled = false;
  const promise = (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) return null;
    const unit = page.getViewport({ scale: 1 });
    const width = Math.min(Math.max(targetPxWidth, 32), 3200);
    const viewport = page.getViewport({ scale: width / unit.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    task = page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' });
    await task.promise;
    return canvas;
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* already finished */
      }
    },
  };
}

export async function renderThumb(doc, pageNumber, width = 260) {
  const canvas = await renderPage(doc, pageNumber, width).promise;
  return canvas ? canvas.toDataURL('image/jpeg', 0.82) : null;
}

export function friendlyPdfError(err) {
  if (err?.name === 'PasswordException') return 'it is password-protected. Remove the password first';
  if (err?.name === 'InvalidPDFException') return 'it is not a valid PDF';
  return err?.message || 'could not be read';
}
