import Icon from './Icon.jsx';

const FEATURES = [
  { icon: 'copy', title: 'Merge', text: 'Combine several PDFs into one' },
  { icon: 'grid', title: 'Reorder', text: 'Drag pages into a new order' },
  { icon: 'rotate-cw', title: 'Rotate & tidy', text: 'Rotate, duplicate or delete pages' },
  { icon: 'image', title: 'Images', text: 'Place and resize images on any page' },
  { icon: 'type', title: 'Text', text: 'Type on pages, Hindi and ₹ included' },
  { icon: 'square', title: 'Cover', text: 'Hide old content and write over it' },
];

export default function EmptyState({ onPick, onBlank }) {
  return (
    <div className="empty">
      <div className="empty-hero">
        <div className="empty-copy">
          <span className="empty-eyebrow">
            <span className="empty-dot" aria-hidden="true" /> Private: runs entirely in your browser
          </span>
          <h1>
            Edit, merge and arrange your PDFs, <em>without uploading them</em>.
          </h1>
          <p>
            Drop one PDF to edit it, or several to merge them. Images you drop become pages of their own. Your files
            never leave this device.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn primary lg" onClick={onPick}>
              <Icon name="upload" /> Choose files
            </button>
            <button type="button" className="btn lg" onClick={onBlank}>
              <Icon name="file-plus" /> Start with a blank page
            </button>
          </div>
          <p className="empty-hint">…or drag PDFs and images anywhere on this window.</p>
        </div>

        <button type="button" className="empty-art" onClick={onPick} aria-label="Choose files">
          <span className="sheet sheet-back" aria-hidden="true" />
          <span className="sheet sheet-mid" aria-hidden="true" />
          <span className="sheet sheet-front" aria-hidden="true">
            <span className="ln w80" />
            <span className="ln w95 hl" />
            <span className="ln w70" />
            <span className="ln-box">
              <span className="ln w60" />
            </span>
            <span className="ln w90" />
            <span className="ln w50" />
            <span className="img-ph" />
          </span>
          <span className="empty-drop" aria-hidden="true">
            <Icon name="upload" size={18} /> Drop files
          </span>
        </button>
      </div>

      <ul className="empty-features">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <span className="feat-icon">
              <Icon name={f.icon} size={18} />
            </span>
            <span>
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
