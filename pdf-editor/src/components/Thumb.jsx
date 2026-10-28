import { memo } from 'react';
import Icon from './Icon.jsx';
import { PageFrame, StaticOverlays, fitWidth } from './PageFrame.jsx';

const Thumb = memo(function Thumb({ page, index, thumbUrl, selected, current, marker, maxW, maxH, assets, handlers }) {
  const localW = fitWidth(page, maxW, maxH);
  const base =
    page.srcId == null ? (
      <div className="blank" />
    ) : thumbUrl ? (
      <img className="thumb-img" src={thumbUrl} alt="" draggable={false} />
    ) : (
      <div className="thumb-skel" />
    );

  return (
    <div
      id={`thumb-${page.id}`}
      className={`thumb${selected ? ' selected' : ''}${current ? ' current' : ''}`}
      draggable
      onDragStart={(e) => handlers.onDragStart(e, page.id)}
      onDragOver={(e) => handlers.onDragOver(e, page.id)}
      onDrop={(e) => handlers.onDrop(e, page.id)}
      onDragEnd={handlers.onDragEnd}
      onClick={(e) => handlers.onSelect(page.id, e)}
      onDoubleClick={() => handlers.onOpen(page.id)}
      aria-label={`Page ${index + 1}`}
      aria-selected={selected}
    >
      <div className="thumb-box" style={{ width: maxW, height: maxH }}>
        <PageFrame page={page} localW={localW} base={base}>
          <StaticOverlays page={page} assets={assets} scale={localW / page.vw} />
        </PageFrame>
      </div>
      <div className="thumb-meta">
        <span className="idx">{index + 1}</span>
        {page.overlays.length > 0 && (
          <span className="badge" title="Has added images, text or boxes">
            <Icon name="type" size={12} /> {page.overlays.length}
          </span>
        )}
      </div>
      <button
        type="button"
        className="check"
        aria-label={selected ? `Deselect page ${index + 1}` : `Select page ${index + 1}`}
        onClick={(e) => {
          e.stopPropagation();
          handlers.onToggle(page.id);
        }}
      >
        <Icon name="check" size={13} />
      </button>
      {marker && <i className={`drop-marker ${marker}`} />}
    </div>
  );
});

export default Thumb;
