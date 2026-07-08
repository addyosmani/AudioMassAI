import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UndoHistory } from '../../src/core/undo-history.js';

function makeApp() {
  const listeners = {};
  return {
    listeners,
    fireEvent: vi.fn((name, a, b) => {
      (listeners[name] || []).forEach((cb) => cb(a, b));
    }),
    listenFor: vi.fn((name, cb) => {
      (listeners[name] ||= []).push(cb);
    }),
    engine: {
      wavesurfer: { backend: { buffer: 'CURRENT_BUFFER' } },
    },
  };
}

describe('UndoHistory', () => {
  let app;
  let history;

  beforeEach(() => {
    app = makeApp();
    history = new UndoHistory(3, app);
  });

  it('pushes states and reports the stack size', () => {
    expect(history.pushUndoState({ desc: 'Cut', data: 'A' })).toBe(true);
    expect(app.fireEvent).toHaveBeenCalledWith('StatePush', 1);
    expect(history.getLastUndoState().desc).toBe('Cut');
  });

  it('rejects empty states', () => {
    expect(history.pushUndoState(null)).toBe(false);
  });

  it('evicts the oldest state beyond the configured depth', () => {
    for (let i = 0; i < 4; i++) history.pushUndoState({ desc: `edit ${i}` });

    // depth is 3: the first state must have been shifted out
    const stacks = [];
    app.listenFor('DidStateChange', (undo) => stacks.push([...undo]));
    history.pushUndoState({ desc: 'edit 4' });

    expect(stacks[0]).toHaveLength(3);
    expect(stacks[0][0].desc).toBe('edit 2');
  });

  it('moves a popped state to the redo stack carrying the current buffer', () => {
    history.pushUndoState({ desc: 'Cut', data: 'OLD_BUFFER' });

    const popped = history.popUndoState();
    expect(popped.desc).toBe('Cut');
    // the entry now carries the buffer being replaced, for redo
    expect(popped.data).toBe('CURRENT_BUFFER');
    expect(app.fireEvent).toHaveBeenCalledWith('StateDidPop', popped, 1);

    const redone = history.shiftRedoState();
    expect(redone.desc).toBe('Cut');
    expect(app.fireEvent).toHaveBeenCalledWith('StateDidPop', redone, 0);
  });

  it('clears both stacks on clearAllState', () => {
    history.pushUndoState({ desc: 'Cut' });
    history.popUndoState();
    history.clearAllState();

    expect(history.getLastUndoState()).toBeUndefined();
    expect(history.shiftRedoState()).toBeUndefined();
    expect(app.fireEvent).toHaveBeenCalledWith('StateClearAll');
  });

  it('drives the same operations through the event bus', () => {
    app.fireEvent('StateRequestPush', { desc: 'Paste' });
    expect(history.getLastUndoState().desc).toBe('Paste');

    app.fireEvent('StateRequestUndo');
    expect(history.getLastUndoState()).toBeUndefined();

    app.fireEvent('StateRequestRedo');
    expect(history.getLastUndoState().desc).toBe('Paste');

    app.fireEvent('StateRequestClearAll');
    expect(history.getLastUndoState()).toBeUndefined();
  });

  it('invalidates the redo stack when a non-contiguous state is pushed', () => {
    app.fireEvent('StateRequestPush', { desc: 'first' });
    app.fireEvent('StateRequestPush', { desc: 'second' });
    app.fireEvent('StateRequestUndo');

    // a fresh edit after an undo must clear the redo stack
    app.fireEvent('StateRequestPush', { desc: 'third', id: 99 });
    expect(history.shiftRedoState()).toBeUndefined();
  });
});
