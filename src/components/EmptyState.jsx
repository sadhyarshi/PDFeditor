import Icon from './Icon.jsx';

export default function EmptyState({ onPick, onBlank }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-icon">
          <Icon name="upload" size={28} />
        </div>
        <h1>Drop PDFs here to start editing</h1>
        <p>
          Add one PDF to edit it, or several to merge them. Images you drop become pages of their own. Everything runs
          in your browser, so files are never uploaded.
        </p>
        <div className="empty-actions">
          <button type="button" className="btn primary" onClick={onPick}>
            <Icon name="upload" /> Choose files
          </button>
          <button type="button" className="btn" onClick={onBlank}>
            <Icon name="file-plus" /> Start with a blank page
          </button>
        </div>
        <ul className="empty-list">
          <li>Merge several PDFs into one</li>
          <li>Drag pages into a new order</li>
          <li>Delete, duplicate or rotate pages</li>
          <li>Place images on any page and resize them</li>
        </ul>
      </div>
    </div>
  );
}
