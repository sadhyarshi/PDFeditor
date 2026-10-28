// Undo/redo for the page list.
//  commit  – replace the pages with `next` and record an undo step
//  live    – continuous edit (dragging, slider): updates pages, records ONE undo step on live_end
//            (or when the next commit/undo happens)
const LIMIT = 100;

export const initialHistory = { past: [], present: [], future: [], anchor: null };

const pending = (s) => (s.anchor && s.anchor !== s.present ? s.anchor : null);

export function historyReducer(state, action) {
  switch (action.type) {
    case 'commit': {
      if (action.next === state.present) return state;
      const open = pending(state);
      return {
        past: [...state.past, ...(open ? [open] : []), state.present].slice(-LIMIT),
        present: action.next,
        future: [],
        anchor: null,
      };
    }
    case 'live': {
      const next = action.fn(state.present);
      if (next === state.present) return state;
      return { ...state, present: next, anchor: state.anchor ?? state.present };
    }
    case 'live_end': {
      const open = pending(state);
      if (open) {
        return { past: [...state.past, open].slice(-LIMIT), present: state.present, future: [], anchor: null };
      }
      return state.anchor ? { ...state, anchor: null } : state;
    }
    case 'undo': {
      const open = pending(state);
      if (open) return { past: state.past, present: open, future: [state.present, ...state.future], anchor: null };
      if (!state.past.length) return state.anchor ? { ...state, anchor: null } : state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
        anchor: null,
      };
    }
    case 'redo': {
      if (!state.future.length) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
        anchor: null,
      };
    }
    default:
      return state;
  }
}
