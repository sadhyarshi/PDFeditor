import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import Icon from './components/Icon.jsx';
import Thumb from './components/Thumb.jsx';
import Viewer from './components/Viewer.jsx';
import EmptyState from './components/EmptyState.jsx';
import { historyReducer, initialHistory } from './lib/history.js';
import { friendlyPdfError, openPdf, renderThumb } from './lib/pdfjs.js';
import { prepareImage } from './lib/image.js';
import { buildPdf } from './lib/exportPdf.js';
import { loadFont } from './lib/fontsCss.js';
import { uid } from './lib/ids.js';

const A4 = [595.28, 841.89];
const DEFAULT_NAME = 'edited.pdf';

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name);
const stem = (n) => n.replace(/\.[^.]+$/, '');
const toPdfName = (n) => {
  const clean = (n || '').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'edited';
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
};

function saveBytes(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function App() {
  const [hist, dispatch] = useReducer(historyReducer, initialHistory);
  const pages = hist.present;

  const [thumbs, setThumbs] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [currentId, setCurrentId] = useState(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [editingOverlayId, setEditingOverlayId] = useState(null); // text box being typed in
  const [view, setView] = useState('edit');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [fileDrag, setFileDrag] = useState(false);
  const [filename, setFilename] = useState(DEFAULT_NAME);

  // Heavy / non-visual data lives in refs; page records only reference it by id.
  const sourcesRef = useRef(new Map()); // srcId -> { name, bytes, doc }
  const assetsRef = useRef(new Map()); // assetId -> { bytes, mime, nw, nh, url }
  const srcCounter = useRef(0);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const selRef = useRef(selected);
  selRef.current = selected;
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const overlayRef = useRef(selectedOverlayId);
  overlayRef.current = selectedOverlayId;
  const viewRef = useRef(view);
  viewRef.current = view;
  const dropRef = useRef(dropTarget);
  dropRef.current = dropTarget;
  const anchorRef = useRef(null);
  const dragIdsRef = useRef(null);
  const toastTimer = useRef(null);
  const addInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const commit = useCallback((next) => dispatch({ type: 'commit', next }), []);

  const showToast = useCallback((message, kind = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 8000 : 4000);
  }, []);

  // Keep selection / current page valid after undo, redo, delete.
  useEffect(() => {
    const ids = new Set(pages.map((p) => p.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setCurrentId((cur) => (cur && ids.has(cur) ? cur : (pages[0]?.id ?? null)));
  }, [pages]);

  // Invariant: while there are pages, at least one is selected.
  useEffect(() => {
    if (currentId && selected.size === 0) setSelected(new Set([currentId]));
  }, [currentId, selected]);

  useEffect(() => {
    setSelectedOverlayId(null);
    setEditingOverlayId(null);
  }, [currentId]);

  const currentIndex = pages.findIndex((p) => p.id === currentId);
  const currentPage = currentIndex >= 0 ? pages[currentIndex] : null;

  useEffect(() => {
    if (view === 'edit' && currentId) {
      document.getElementById(`thumb-${currentId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [currentId, view]);

  /* ---------------------------------------------------------------- loading files */

  const startThumbs = useCallback(async (srcId, recs) => {
    const src = sourcesRef.current.get(srcId);
    if (!src) return;
    let buffer = {};
    let n = 0;
    const flush = () => {
      if (!n) return;
      const batch = buffer;
      buffer = {};
      n = 0;
      setThumbs((t) => ({ ...t, ...batch }));
    };
    for (const r of recs) {
      try {
        const url = await renderThumb(src.doc, r.srcIndex + 1, 260);
        if (url) {
          buffer[r.thumbKey] = url;
          n++;
        }
      } catch (err) {
        console.warn('Thumbnail failed', err);
      }
      if (n >= 5) flush();
    }
    flush();
  }, []);

  const readPdf = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      if (err instanceof EncryptedPDFError) {
        throw new Error('it is encrypted or password-protected. Remove the protection first');
      }
      throw new Error('it could not be read as a PDF');
    }
    let doc;
    try {
      doc = await openPdf(bytes);
    } catch (err) {
      throw new Error(friendlyPdfError(err));
    }
    const srcId = ++srcCounter.current;
    sourcesRef.current.set(srcId, { name: file.name, bytes, doc });
    const recs = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      const id = uid('p');
      recs.push({
        id,
        srcId,
        srcIndex: i - 1,
        base: pg.rotate || 0,
        vw: vp.width,
        vh: vp.height,
        rot: 0,
        overlays: [],
        thumbKey: id,
      });
    }
    return { srcId, recs };
  };

  const readImageAsPage = async (file) => {
    const asset = await prepareImage(file);
    const assetId = uid('a');
    assetsRef.current.set(assetId, asset);
    const long = A4[1];
    const [vw, vh] =
      asset.nw >= asset.nh ? [long, (long * asset.nh) / asset.nw] : [(long * asset.nw) / asset.nh, long];
    const id = uid('p');
    return {
      id,
      srcId: null,
      srcIndex: 0,
      base: 0,
      vw,
      vh,
      rot: 0,
      thumbKey: id,
      overlays: [{ id: uid('o'), kind: 'image', assetId, fx: 0, fy: 0, fw: 1, fh: 1, opacity: 1 }],
    };
  };

  const addFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      const added = [];
      const jobs = [];
      const errors = [];

      for (const file of files) {
        setBusy(`Reading ${file.name}…`);
        try {
          if (isPdf(file)) {
            const { srcId, recs } = await readPdf(file);
            added.push(...recs);
            jobs.push([srcId, recs]);
            setFilename((f) => (f === DEFAULT_NAME ? `${stem(file.name)}-edited.pdf` : f));
          } else if (isImage(file)) {
            added.push(await readImageAsPage(file));
          } else {
            errors.push(`${file.name}: only PDF and image files are supported`);
          }
        } catch (err) {
          errors.push(`${file.name}: ${err.message}`);
        }
      }
      setBusy('');

      if (added.length) {
        commit([...pagesRef.current, ...added]);
        setSelected(new Set([added[0].id]));
        setCurrentId(added[0].id);
        anchorRef.current = added[0].id;
        jobs.forEach(([srcId, recs]) => startThumbs(srcId, recs));
        showToast(`Added ${added.length} page${added.length === 1 ? '' : 's'}`, 'success');
      }
      if (errors.length) showToast(errors.join('\n'), 'error');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, showToast, startThumbs],
  );

  // Drop files anywhere on the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setFileDrag(true);
    };
    const over = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setFileDrag(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setFileDrag(false);
      addFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  /* ---------------------------------------------------------------- page operations */

  const deleteSelected = useCallback(() => {
    const sel = selRef.current;
    const list = pagesRef.current;
    const first = list.findIndex((p) => sel.has(p.id));
    if (first < 0) return;
    const next = list.filter((p) => !sel.has(p.id));
    commit(next);
    const focus = next[Math.min(first, next.length - 1)];
    setCurrentId(focus?.id ?? null);
    setSelected(new Set(focus ? [focus.id] : []));
  }, [commit]);

  const rotateSelected = useCallback(
    (dir) => {
      const sel = selRef.current;
      commit(pagesRef.current.map((p) => (sel.has(p.id) ? { ...p, rot: (p.rot + dir * 90 + 360) % 360 } : p)));
    },
    [commit],
  );

  const duplicateSelected = useCallback(() => {
    const sel = selRef.current;
    const out = [];
    const created = [];
    for (const p of pagesRef.current) {
      out.push(p);
      if (sel.has(p.id)) {
        const copy = { ...p, id: uid('p'), overlays: p.overlays.map((o) => ({ ...o, id: uid('o') })) };
        out.push(copy);
        created.push(copy.id);
      }
    }
    if (!created.length) return;
    commit(out);
    setSelected(new Set(created));
    setCurrentId(created[0]);
  }, [commit]);

  const insertBlank = useCallback(() => {
    const list = pagesRef.current;
    const sel = selRef.current;
    let at = -1;
    list.forEach((p, i) => {
      if (sel.has(p.id)) at = i;
    });
    const ref = list[at] ?? list[list.length - 1];
    const [vw, vh] = ref ? [ref.vw, ref.vh] : A4;
    const id = uid('p');
    const blank = { id, srcId: null, srcIndex: 0, base: 0, vw, vh, rot: 0, overlays: [], thumbKey: id };
    commit([...list.slice(0, at + 1), blank, ...list.slice(at + 1)]);
    setSelected(new Set([id]));
    setCurrentId(id);
  }, [commit]);

  const moveSelectedBy = useCallback(
    (dir) => {
      const sel = selRef.current;
      const before = pagesRef.current;
      const a = [...before];
      if (dir < 0) {
        for (let i = 1; i < a.length; i++) {
          if (sel.has(a[i].id) && !sel.has(a[i - 1].id)) [a[i - 1], a[i]] = [a[i], a[i - 1]];
        }
      } else {
        for (let i = a.length - 2; i >= 0; i--) {
          if (sel.has(a[i].id) && !sel.has(a[i + 1].id)) [a[i + 1], a[i]] = [a[i], a[i + 1]];
        }
      }
      if (a.some((p, i) => p !== before[i])) commit(a);
    },
    [commit],
  );

  const movePages = useCallback(
    (ids, targetId, side) => {
      const list = pagesRef.current;
      const set = new Set(ids);
      if (set.has(targetId)) return;
      const moving = list.filter((p) => set.has(p.id));
      const rest = list.filter((p) => !set.has(p.id));
      let at = rest.findIndex((p) => p.id === targetId);
      if (at < 0) return;
      if (side === 'after') at++;
      const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      if (next.some((p, i) => p !== list[i])) commit(next);
    },
    [commit],
  );

  const deleteOverlay = useCallback(
    (pageId, overlayId) => {
      commit(
        pagesRef.current.map((p) =>
          p.id === pageId ? { ...p, overlays: p.overlays.filter((o) => o.id !== overlayId) } : p,
        ),
      );
      setSelectedOverlayId(null);
      setEditingOverlayId(null);
    },
    [commit],
  );

  const updateOverlay = useCallback(
    (overlayId, values) => {
      const pageId = currentRef.current;
      commit(
        pagesRef.current.map((p) =>
          p.id !== pageId ? p : { ...p, overlays: p.overlays.map((o) => (o.id === overlayId ? { ...o, ...values } : o)) },
        ),
      );
    },
    [commit],
  );

  /** Adds a new overlay to the current page and selects it. */
  const addOverlay = useCallback(
    (build, { edit = false } = {}) => {
      const cur = pagesRef.current.find((p) => p.id === currentRef.current);
      if (!cur) return;
      setView('edit');
      const overlay = { id: uid('o'), ...build(cur) };
      commit(pagesRef.current.map((p) => (p.id === cur.id ? { ...p, overlays: [...p.overlays, overlay] } : p)));
      setSelectedOverlayId(overlay.id);
      setEditingOverlayId(edit ? overlay.id : null);
    },
    [commit],
  );

  const addText = useCallback(
    () =>
      addOverlay(
        (cur) => ({
          kind: 'text',
          text: 'Text',
          fx: 0.12 + 0.03 * (cur.overlays.filter((o) => o.kind === 'text').length % 6),
          fy: 0.15 + 0.04 * (cur.overlays.filter((o) => o.kind === 'text').length % 6),
          size: Math.round(Math.min(cur.vw, cur.vh) * 0.04),
          family: 'sans',
          bold: false,
          italic: false,
          align: 'left',
          color: '#111111',
          opacity: 1,
        }),
        { edit: true },
      ),
    [addOverlay],
  );

  // A filled box to hide existing content ("whiteout"); retype over it with the text tool.
  const addCover = useCallback(
    () => addOverlay(() => ({ kind: 'rect', color: '#ffffff', opacity: 1, fx: 0.2, fy: 0.4, fw: 0.5, fh: 0.06 })),
    [addOverlay],
  );

  const finishText = useCallback(
    (overlayId, text) => {
      setEditingOverlayId(null);
      if (!text.trim()) {
        if (currentRef.current) deleteOverlay(currentRef.current, overlayId);
      } else {
        updateOverlay(overlayId, { text });
      }
    },
    [deleteOverlay, updateOverlay],
  );

  const insertImages = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []).filter(isImage);
      const cur = pagesRef.current.find((p) => p.id === currentRef.current);
      if (!cur) return;
      if (!files.length) {
        showToast('Choose a PNG, JPEG, WebP, GIF or SVG image', 'error');
        return;
      }
      setBusy('Reading image…');
      const overlays = [];
      const errors = [];
      for (const [i, file] of files.entries()) {
        try {
          const asset = await prepareImage(file);
          const assetId = uid('a');
          assetsRef.current.set(assetId, asset);
          let w = cur.vw * 0.4;
          let h = (w * asset.nh) / asset.nw;
          if (h > cur.vh * 0.6) {
            h = cur.vh * 0.6;
            w = (h * asset.nw) / asset.nh;
          }
          const fw = w / cur.vw;
          const fh = h / cur.vh;
          const nudge = Math.min(i * 0.03, 0.2);
          overlays.push({
            id: uid('o'),
            kind: 'image',
            assetId,
            fx: Math.min((1 - fw) / 2 + nudge, 1 - fw),
            fy: Math.min((1 - fh) / 2 + nudge, 1 - fh),
            fw,
            fh,
            opacity: 1,
          });
        } catch (err) {
          errors.push(`${file.name}: ${err.message}`);
        }
      }
      setBusy('');
      if (overlays.length) {
        commit(
          pagesRef.current.map((p) => (p.id === cur.id ? { ...p, overlays: [...p.overlays, ...overlays] } : p)),
        );
        setSelectedOverlayId(overlays[overlays.length - 1].id);
      }
      if (errors.length) showToast(errors.join('\n'), 'error');
    },
    [commit, showToast],
  );

  /* ---------------------------------------------------------------- selection */

  const onSelect = useCallback((id, e) => {
    const list = pagesRef.current;
    if (e.shiftKey && anchorRef.current) {
      const a = list.findIndex((p) => p.id === anchorRef.current);
      const b = list.findIndex((p) => p.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(list.slice(lo, hi + 1).map((p) => p.id)));
        setCurrentId(id);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
    setCurrentId(id);
    anchorRef.current = id;
  }, []);

  const onToggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  /* ---------------------------------------------------------------- drag to reorder */

  const thumbHandlers = useMemo(
    () => ({
      onSelect,
      onToggle,
      onOpen: (id) => {
        setCurrentId(id);
        setSelected(new Set([id]));
        setView('edit');
      },
      onDragStart: (e, id) => {
        const sel = selRef.current;
        if (sel.has(id)) {
          dragIdsRef.current = pagesRef.current.filter((p) => sel.has(p.id)).map((p) => p.id);
        } else {
          dragIdsRef.current = [id];
          setSelected(new Set([id]));
          setCurrentId(id);
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'pdf-page');
      },
      onDragOver: (e, id) => {
        if (!dragIdsRef.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect();
        const horizontal = viewRef.current === 'grid' || window.innerWidth <= 760;
        const before = horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
        const side = before ? 'before' : 'after';
        setDropTarget((t) => (t && t.id === id && t.side === side ? t : { id, side }));
      },
      onDrop: (e, id) => {
        if (!dragIdsRef.current) return;
        e.preventDefault();
        const t = dropRef.current;
        movePages(dragIdsRef.current, id, t && t.id === id ? t.side : 'before');
        dragIdsRef.current = null;
        setDropTarget(null);
      },
      onDragEnd: () => {
        dragIdsRef.current = null;
        setDropTarget(null);
      },
    }),
    [movePages, onSelect, onToggle],
  );

  /* ---------------------------------------------------------------- export */

  const exportPdf = async (onlySelected) => {
    const sel = selRef.current;
    const list = onlySelected ? pagesRef.current.filter((p) => sel.has(p.id)) : pagesRef.current;
    if (!list.length) return;
    setBusy(`Building PDF with ${list.length} page${list.length === 1 ? '' : 's'}…`);
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the busy overlay paint first
      const bytes = await buildPdf({
        pages: list,
        sources: sourcesRef.current,
        assets: assetsRef.current,
        loadFont,
      });
      const base = toPdfName(filename);
      saveBytes(bytes, onlySelected ? base.replace(/\.pdf$/i, '-selected.pdf') : base);
      showToast('PDF downloaded', 'success');
    } catch (err) {
      console.error(err);
      showToast(`Could not build the PDF: ${err.message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  /* ---------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && key === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelected(new Set(pagesRef.current.map((p) => p.id)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!pagesRef.current.length) return;
        e.preventDefault();
        if (overlayRef.current && currentRef.current) deleteOverlay(currentRef.current, overlayRef.current);
        else deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteOverlay, deleteSelected]);

  /* ---------------------------------------------------------------- render */

  const hasPages = pages.length > 0;
  const selCount = selected.size;
  const thumbMax = view === 'grid' ? [180, 240] : [132, 176];

  const thumbList = (
    <div className={`thumbs ${view === 'grid' ? 'grid' : 'list'}`} role="listbox" aria-label="Pages" aria-multiselectable="true">
      {pages.map((p, i) => (
        <Thumb
          key={p.id}
          page={p}
          index={i}
          thumbUrl={thumbs[p.thumbKey]}
          selected={selected.has(p.id)}
          current={p.id === currentId}
          marker={dropTarget?.id === p.id ? dropTarget.side : null}
          maxW={thumbMax[0]}
          maxH={thumbMax[1]}
          assets={assetsRef.current}
          handlers={thumbHandlers}
        />
      ))}
    </div>
  );

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="2" width="16" height="20" rx="2.5" fill="var(--accent)" />
            <path d="M8 8h8M8 12h8M8 16h5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <div>
            <div className="brand-name">PDF Editor</div>
            <div className="brand-sub">Runs in your browser. Files are never uploaded.</div>
          </div>
        </div>

        <div className="grp">
          <button type="button" className="btn" onClick={() => addInputRef.current?.click()}>
            <Icon name="upload" /> <span className="lbl">Add files</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Undo (Ctrl+Z)"
            disabled={!hist.past.length}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!hist.future.length}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Icon name="redo" />
          </button>
        </div>

        <div className="spacer" />

        {hasPages && (
          <div className="grp export">
            <input
              className="field"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              aria-label="File name"
              spellCheck={false}
            />
            {selCount > 0 && selCount < pages.length && (
              <button type="button" className="btn" onClick={() => exportPdf(true)}>
                <Icon name="download" /> <span className="lbl">Save {selCount} selected</span>
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => exportPdf(false)}>
              <Icon name="download" /> Download PDF
            </button>
          </div>
        )}
      </header>

      {!hasPages ? (
        <EmptyState onPick={() => addInputRef.current?.click()} onBlank={insertBlank} />
      ) : (
        <>
          <div className="actionbar" role="toolbar" aria-label="Page actions">
            <div className="grp">
              <button
                type="button"
                className="icon-btn flat"
                title="Rotate left"
                aria-label="Rotate left"
                onClick={() => rotateSelected(-1)}
              >
                <Icon name="rotate-ccw" />
              </button>
              <button
                type="button"
                className="icon-btn flat"
                title="Rotate right"
                aria-label="Rotate right"
                onClick={() => rotateSelected(1)}
              >
                <Icon name="rotate-cw" />
              </button>
            </div>
            <div className="grp">
              <button
                type="button"
                className="icon-btn flat"
                title="Move earlier"
                aria-label="Move earlier"
                onClick={() => moveSelectedBy(-1)}
              >
                <Icon name={view === 'grid' ? 'arrow-left' : 'arrow-up'} />
              </button>
              <button
                type="button"
                className="icon-btn flat"
                title="Move later"
                aria-label="Move later"
                onClick={() => moveSelectedBy(1)}
              >
                <Icon name={view === 'grid' ? 'arrow-right' : 'arrow-down'} />
              </button>
            </div>
            <div className="grp">
              <button type="button" className="btn ghost" title="Duplicate page" onClick={duplicateSelected}>
                <Icon name="copy" /> <span className="lbl">Duplicate</span>
              </button>
              <button type="button" className="btn ghost" title="Insert a blank page after the selection" onClick={insertBlank}>
                <Icon name="file-plus" /> <span className="lbl">Blank page</span>
              </button>
              <button
                type="button"
                className="btn ghost"
                title="Place an image on the current page"
                disabled={!currentPage}
                onClick={() => imageInputRef.current?.click()}
              >
                <Icon name="image" /> <span className="lbl">Insert image</span>
              </button>
              <button
                type="button"
                className="btn ghost"
                title="Add a text box to the current page"
                disabled={!currentPage}
                onClick={addText}
              >
                <Icon name="type" /> <span className="lbl">Add text</span>
              </button>
              <button
                type="button"
                className="btn ghost"
                title="Add a coloured box to cover existing content. Retype over it with Add text"
                disabled={!currentPage}
                onClick={addCover}
              >
                <Icon name="square" /> <span className="lbl">Cover</span>
              </button>
            </div>
            <div className="grp">
              <button type="button" className="btn ghost danger" title="Delete selected pages (Delete)" onClick={deleteSelected}>
                <Icon name="trash" /> <span className="lbl">Delete</span>
              </button>
            </div>
            <div className="spacer" />
            <div className="grp">
              <button
                type="button"
                className="btn ghost"
                title="Select all pages (Ctrl+A)"
                onClick={() => setSelected(new Set(pages.map((p) => p.id)))}
              >
                <Icon name="check-square" /> <span className="lbl">Select all</span>
              </button>
              <div className="seg" role="group" aria-label="View">
                <button
                  type="button"
                  className={view === 'edit' ? 'on' : ''}
                  aria-pressed={view === 'edit'}
                  onClick={() => setView('edit')}
                >
                  <Icon name="panel" size={16} /> <span className="lbl">Editor</span>
                </button>
                <button
                  type="button"
                  className={view === 'grid' ? 'on' : ''}
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  <Icon name="grid" size={16} /> <span className="lbl">All pages</span>
                </button>
              </div>
            </div>
          </div>

          <main className={`main ${view}`}>
            {view === 'edit' ? (
              <>
                <aside className="sidebar">{thumbList}</aside>
                {currentPage && (
                  <Viewer
                    page={currentPage}
                    index={currentIndex}
                    count={pages.length}
                    source={currentPage.srcId == null ? null : sourcesRef.current.get(currentPage.srcId)}
                    assets={assetsRef.current}
                    selectedOverlayId={selectedOverlayId}
                    editingOverlayId={editingOverlayId}
                    onSelectOverlay={setSelectedOverlayId}
                    onEditOverlay={(id) => {
                      setSelectedOverlayId(id);
                      setEditingOverlayId(id);
                    }}
                    onFinishText={finishText}
                    onUpdateOverlay={updateOverlay}
                    dispatch={dispatch}
                    onPrev={() => pages[currentIndex - 1] && onSelect(pages[currentIndex - 1].id, {})}
                    onNext={() => pages[currentIndex + 1] && onSelect(pages[currentIndex + 1].id, {})}
                    onDeleteOverlay={(overlayId) => deleteOverlay(currentPage.id, overlayId)}
                  />
                )}
              </>
            ) : (
              <div className="grid-wrap">{thumbList}</div>
            )}
          </main>

          <footer className="statusbar">
            <span>
              {pages.length} page{pages.length === 1 ? '' : 's'}
            </span>
            <span>{selCount} selected</span>
            <span className="hint">
              Drag pages to reorder · Ctrl/Shift-click to select several · Double-click opens a page
            </span>
          </footer>
        </>
      )}

      {busy && (
        <div className="busy" role="status">
          <div className="spinner" />
          {busy}
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
      {fileDrag && (
        <div className="dropveil">
          <div>Drop to add PDFs and images</div>
        </div>
      )}

      <input
        ref={addInputRef}
        type="file"
        hidden
        multiple
        accept="application/pdf,.pdf,image/*"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        hidden
        multiple
        accept="image/*"
        onChange={(e) => {
          insertImages(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
