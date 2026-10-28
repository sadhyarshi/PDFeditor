import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { PageFrame, textStyle } from './PageFrame.jsx';
import { renderPage } from '../lib/pdfjs.js';
import { FAMILIES, hasItalic } from '../lib/fonts.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
const CORNERS = ['tl', 'tr', 'bl', 'br'];

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function PageCanvas({ doc, pageNumber, cssWidth }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!doc) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const job = renderPage(doc, pageNumber, Math.round(cssWidth * dpr));
    let alive = true;
    job.promise
      .then((off) => {
        const canvas = ref.current;
        if (!alive || !off || !canvas) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext('2d').drawImage(off, 0, 0);
      })
      .catch((err) => {
        if (err?.name !== 'RenderingCancelledException') console.error(err);
      });
    return () => {
      alive = false;
      job.cancel();
    };
  }, [doc, pageNumber, cssWidth]);
  return <canvas ref={ref} className="page-canvas" />;
}

/** A text box on the page. Shows plain text, or becomes editable in place (double-click). */
function TextBox({ o, scale, selected, editing, handlers, onFinish }) {
  const ref = useRef(null);

  // Plain display: written imperatively so it never fights with what the user typed.
  useLayoutEffect(() => {
    if (!editing && ref.current) ref.current.textContent = o.text;
  }, [o.text, editing]);

  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.textContent = o.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // only when editing starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = () => {
    const text = (ref.current?.innerText ?? '').replace(/ /g, ' ').replace(/\n+$/, '');
    onFinish(o.id, text);
  };

  return (
    <div
      ref={ref}
      className={`ov ov-text${selected ? ' sel' : ''}${editing ? ' editing' : ''}`}
      style={{ left: `${o.fx * 100}%`, top: `${o.fy * 100}%`, ...textStyle(o, scale) }}
      contentEditable={editing ? 'plaintext-only' : 'false'}
      suppressContentEditableWarning
      spellCheck={false}
      onPointerDown={editing ? (e) => e.stopPropagation() : (e) => handlers.down(e, o, 'move')}
      onPointerMove={editing ? undefined : handlers.move}
      onPointerUp={editing ? undefined : handlers.up}
      onPointerCancel={editing ? undefined : handlers.up}
      onDoubleClick={editing ? undefined : () => handlers.edit(o.id)}
      onBlur={editing ? finish : undefined}
      onKeyDown={
        editing
          ? (e) => {
              e.stopPropagation();
              if (e.key === 'Escape') ref.current?.blur();
            }
          : undefined
      }
    />
  );
}

/** Everything the user added to the page. All coordinates are fractions of the page. */
function EditableOverlays({ page, localW, localH, assets, selectedId, editingId, onSelect, onEdit, onFinishText, dispatch }) {
  const drag = useRef(null);
  const scale = localW / page.vw;

  // The page may be rotated with CSS; convert a screen-space movement into page-space.
  const toLocal = (dx, dy) => {
    switch (page.rot) {
      case 90:
        return [dy, -dx];
      case 180:
        return [-dx, -dy];
      case 270:
        return [-dy, dx];
      default:
        return [dx, dy];
    }
  };

  const patch = (id, values) =>
    dispatch({
      type: 'live',
      fn: (pages) =>
        pages.map((pg) =>
          pg.id !== page.id ? pg : { ...pg, overlays: pg.overlays.map((o) => (o.id === id ? { ...o, ...values } : o)) },
        ),
    });

  const down = (e, o, mode) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(o.id);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    // text boxes are as big as their text, so measure them
    const rect =
      o.kind === 'text'
        ? { fx: o.fx, fy: o.fy, fw: el.offsetWidth / localW, fh: el.offsetHeight / localH }
        : { fx: o.fx, fy: o.fy, fw: o.fw, fh: o.fh };
    drag.current = { id: o.id, kind: o.kind ?? 'image', mode, sx: e.clientX, sy: e.clientY, rect };
  };

  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = toLocal(e.clientX - d.sx, e.clientY - d.sy);
    const r = d.rect;

    if (d.mode === 'move') {
      patch(d.id, {
        fx: clamp(r.fx + dx / localW, 0, Math.max(0, 1 - r.fw)),
        fy: clamp(r.fy + dy / localH, 0, Math.max(0, 1 - r.fh)),
      });
      return;
    }

    // Resize from a corner; the opposite corner stays fixed. Images keep their aspect ratio.
    const px = r.fx * localW;
    const py = r.fy * localH;
    const pw = r.fw * localW;
    const ph = r.fh * localH;
    const left = d.mode.includes('l');
    const top = d.mode.includes('t');
    const ax = left ? px + pw : px;
    const ay = top ? py + ph : py;
    const cx = (left ? px : px + pw) + dx;
    const cy = (top ? py : py + ph) + dy;
    const maxW = left ? ax : localW - ax;
    const maxH = top ? ay : localH - ay;
    let w;
    let h;
    if (d.kind === 'rect') {
      w = clamp(Math.abs(cx - ax), Math.min(8, maxW), maxW);
      h = clamp(Math.abs(cy - ay), Math.min(8, maxH), maxH);
    } else {
      const aspect = pw / ph;
      w = Math.max(Math.abs(cx - ax), Math.abs(cy - ay) * aspect);
      w = Math.max(Math.min(w, maxW, maxH * aspect), Math.min(24, maxW, maxH * aspect));
      h = w / aspect;
    }
    patch(d.id, {
      fx: (left ? ax - w : ax) / localW,
      fy: (top ? ay - h : ay) / localH,
      fw: w / localW,
      fh: h / localH,
    });
  };

  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    dispatch({ type: 'live_end' });
  };

  const handlers = { down, move, up, edit: onEdit };

  return page.overlays.map((o) => {
    const selected = o.id === selectedId;
    if (o.kind === 'text') {
      return (
        <TextBox
          key={o.id}
          o={o}
          scale={scale}
          selected={selected}
          editing={o.id === editingId}
          handlers={handlers}
          onFinish={onFinishText}
        />
      );
    }
    const asset = o.kind === 'rect' ? null : assets.get(o.assetId);
    if (o.kind !== 'rect' && !asset) return null;
    return (
      <div
        key={o.id}
        className={`ov${selected ? ' sel' : ''}`}
        style={{ left: `${o.fx * 100}%`, top: `${o.fy * 100}%`, width: `${o.fw * 100}%`, height: `${o.fh * 100}%` }}
        onPointerDown={(e) => down(e, o, 'move')}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {o.kind === 'rect' ? (
          <div className="rect-fill" style={{ background: o.color, opacity: o.opacity ?? 1 }} />
        ) : (
          <img src={asset.url} alt="" draggable={false} style={{ opacity: o.opacity ?? 1 }} />
        )}
        {selected &&
          CORNERS.map((c) => (
            <span
              key={c}
              className={`handle ${c}`}
              onPointerDown={(e) => down(e, o, c)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
          ))}
      </div>
    );
  });
}

/** Formatting controls for the selected image / text box / cover box. */
function FormatBar({ o, dispatch, pageId, onCommit, onRemove }) {
  const live = (values) =>
    dispatch({
      type: 'live',
      fn: (pages) =>
        pages.map((pg) =>
          pg.id !== pageId ? pg : { ...pg, overlays: pg.overlays.map((x) => (x.id === o.id ? { ...x, ...values } : x)) },
        ),
    });
  const endLive = () => dispatch({ type: 'live_end' });
  const kind = o.kind ?? 'image';

  const opacity = (
    <label className="inline-field">
      Opacity
      <input
        type="range"
        min="10"
        max="100"
        value={Math.round((o.opacity ?? 1) * 100)}
        onChange={(e) => live({ opacity: Number(e.target.value) / 100 })}
        onPointerUp={endLive}
        onBlur={endLive}
      />
    </label>
  );
  const color = (title) => (
    <label className="inline-field">
      {title}
      <input
        type="color"
        value={o.color || '#000000'}
        onChange={(e) => live({ color: e.target.value })}
        onBlur={endLive}
      />
    </label>
  );

  return (
    <div className="overlay-bar" role="toolbar" aria-label="Selected item">
      <span className="lbl-strong">{kind === 'text' ? 'Text' : kind === 'rect' ? 'Cover box' : 'Image'}</span>

      {kind === 'text' && (
        <>
          <select
            className="select"
            aria-label="Font"
            value={o.family}
            onChange={(e) => {
              const family = e.target.value;
              onCommit({ family, italic: hasItalic(family) ? o.italic : false });
            }}
          >
            {Object.entries(FAMILIES).map(([key, f]) => (
              <option key={key} value={key}>
                {f.label}
              </option>
            ))}
          </select>
          <div className="stepper">
            <button type="button" className="icon-btn flat sm" title="Smaller" onClick={() => onCommit({ size: Math.max(4, Math.round(o.size) - 1) })}>
              <Icon name="minus" size={14} />
            </button>
            <input
              type="number"
              aria-label="Font size in points"
              min="4"
              max="400"
              value={Math.round(o.size)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1) live({ size: clamp(v, 1, 400) });
              }}
              onBlur={endLive}
            />
            <button type="button" className="icon-btn flat sm" title="Larger" onClick={() => onCommit({ size: Math.min(400, Math.round(o.size) + 1) })}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          <div className="seg mini" role="group" aria-label="Style">
            <button type="button" className={o.bold ? 'on' : ''} aria-pressed={!!o.bold} title="Bold" onClick={() => onCommit({ bold: !o.bold })}>
              <Icon name="bold" size={15} />
            </button>
            <button
              type="button"
              className={o.italic ? 'on' : ''}
              aria-pressed={!!o.italic}
              title={hasItalic(o.family) ? 'Italic' : 'This font has no italic'}
              disabled={!hasItalic(o.family)}
              onClick={() => onCommit({ italic: !o.italic })}
            >
              <Icon name="italic" size={15} />
            </button>
          </div>
          <div className="seg mini" role="group" aria-label="Alignment">
            {['left', 'center', 'right'].map((a) => (
              <button key={a} type="button" className={(o.align || 'left') === a ? 'on' : ''} aria-pressed={(o.align || 'left') === a} title={`Align ${a}`} onClick={() => onCommit({ align: a })}>
                <Icon name={`align-${a}`} size={15} />
              </button>
            ))}
          </div>
          {color('Colour')}
        </>
      )}
      {kind === 'rect' && color('Fill')}
      {opacity}

      <button type="button" className="btn sm danger" onClick={onRemove}>
        <Icon name="trash" size={15} /> Remove
      </button>
    </div>
  );
}

export default function Viewer({
  page,
  index,
  count,
  source,
  assets,
  selectedOverlayId,
  editingOverlayId,
  onSelectOverlay,
  onEditOverlay,
  onFinishText,
  onUpdateOverlay,
  dispatch,
  onPrev,
  onNext,
  onDeleteOverlay,
}) {
  const scrollRef = useRef(null);
  const [avail, setAvail] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1); // 1 = the whole page fits in the viewer

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) =>
      setAvail({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [page.id]);

  const sideways = page.rot % 180 !== 0;
  const boxW = sideways ? page.vh : page.vw; // size of the page as it is displayed (with rotation)
  const boxH = sideways ? page.vw : page.vh;
  const fit = Math.min(clamp(avail.w - 2, 160, 1100) / boxW, Math.max(avail.h - 2, 160) / boxH);
  const localW = page.vw * fit * zoom;
  const localH = (localW * page.vh) / page.vw;
  const renderW = useDebounced(Math.round(localW), 140);

  const selectedOverlay = page.overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const editingId = editingOverlayId === selectedOverlayId ? editingOverlayId : null;

  return (
    <section className="viewer" aria-label="Page preview">
      <div className="viewer-bar">
        <div className="grp">
          <button type="button" className="icon-btn" title="Previous page" disabled={index === 0} onClick={onPrev}>
            <Icon name="chevron-left" />
          </button>
          <span className="pager">
            Page {index + 1} <em>of {count}</em>
          </span>
          <button type="button" className="icon-btn" title="Next page" disabled={index >= count - 1} onClick={onNext}>
            <Icon name="chevron-right" />
          </button>
        </div>

        <div className="grp zoom">
          <button
            type="button"
            className="icon-btn"
            title="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((z) => clamp(+(z - 0.2).toFixed(2), MIN_ZOOM, MAX_ZOOM))}
          >
            <Icon name="zoom-out" />
          </button>
          <button type="button" className="zoom-readout" title="Fit whole page" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((z) => clamp(+(z + 0.2).toFixed(2), MIN_ZOOM, MAX_ZOOM))}
          >
            <Icon name="zoom-in" />
          </button>
        </div>
      </div>

      {selectedOverlay && (
        <FormatBar
          key={selectedOverlay.id}
          o={selectedOverlay}
          pageId={page.id}
          dispatch={dispatch}
          onCommit={(values) => onUpdateOverlay(selectedOverlay.id, values)}
          onRemove={() => onDeleteOverlay(selectedOverlay.id)}
        />
      )}

      <div className="viewer-scroll" ref={scrollRef} onPointerDown={() => onSelectOverlay(null)}>
        <div className="frame-holder">
          <PageFrame
            page={page}
            localW={localW}
            base={
              page.srcId == null ? (
                <div className="blank" />
              ) : (
                <PageCanvas key={page.id} doc={source?.doc} pageNumber={page.srcIndex + 1} cssWidth={renderW} />
              )
            }
          >
            <EditableOverlays
              page={page}
              localW={localW}
              localH={localH}
              assets={assets}
              selectedId={selectedOverlayId}
              editingId={editingId}
              onSelect={onSelectOverlay}
              onEdit={onEditOverlay}
              onFinishText={onFinishText}
              dispatch={dispatch}
            />
          </PageFrame>
        </div>
      </div>
    </section>
  );
}
