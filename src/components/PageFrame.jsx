import { LINE_HEIGHT, fontStack } from '../lib/fonts.js';

// A page drawn at a given width. `localW` is the width of the page *before* the user's
// rotation; the frame reserves the rotated bounding box and rotates its contents with CSS,
// so everything added to the page (images, text, boxes) always turns together with it.

export function PageFrame({ page, localW, base, children }) {
  const localH = (localW * page.vh) / page.vw;
  const sideways = page.rot % 180 !== 0;
  return (
    <div className="frame" style={{ width: sideways ? localH : localW, height: sideways ? localW : localH }}>
      <div
        className="frame-inner"
        style={{ width: localW, height: localH, transform: `translate(-50%, -50%) rotate(${page.rot}deg)` }}
      >
        {base}
        {children}
      </div>
    </div>
  );
}

/** CSS for a text box. `scale` converts PDF points to screen pixels. */
export function textStyle(o, scale) {
  return {
    fontFamily: fontStack(o.family),
    fontSize: (o.size || 16) * scale,
    fontWeight: o.bold ? 700 : 400,
    fontStyle: o.italic ? 'italic' : 'normal',
    color: o.color,
    textAlign: o.align || 'left',
    lineHeight: LINE_HEIGHT,
    opacity: o.opacity ?? 1,
  };
}

/** Non-interactive view of everything added to a page (used by thumbnails). */
export function StaticOverlays({ page, assets, scale }) {
  return page.overlays.map((o) => {
    const pos = { left: `${o.fx * 100}%`, top: `${o.fy * 100}%` };
    if (o.kind === 'text') {
      return (
        <div key={o.id} className="stext" style={{ ...pos, ...textStyle(o, scale) }}>
          {o.text}
        </div>
      );
    }
    const box = { ...pos, width: `${o.fw * 100}%`, height: `${o.fh * 100}%`, opacity: o.opacity ?? 1 };
    if (o.kind === 'rect') return <div key={o.id} className="srect" style={{ ...box, background: o.color }} />;
    const asset = assets.get(o.assetId);
    if (!asset) return null;
    return <img key={o.id} className="sov" src={asset.url} alt="" draggable={false} style={box} />;
  });
}

/** Size (in px) that fits a page, including its rotation, inside maxW x maxH. */
export function fitWidth(page, maxW, maxH) {
  const sideways = page.rot % 180 !== 0;
  const bw = sideways ? page.vh : page.vw;
  const bh = sideways ? page.vw : page.vh;
  const scale = Math.min(maxW / bw, maxH / bh);
  return page.vw * scale;
}
