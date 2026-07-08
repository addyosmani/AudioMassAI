/**
 * Undo/redo history for destructive edits.
 *
 * Each history entry is `{ id, desc, data (AudioBuffer), meta }`. The store
 * keeps at most `depth` undo entries and invalidates the redo stack whenever
 * a non-contiguous state is pushed (detected through the incremental ids).
 *
 * Communicates with the rest of the app purely through events:
 *   listens:  StateRequestPush / Undo / Redo / ClearAll / LastState
 *   fires:    StatePush, StateDidPop, StateClearAll, DidStateChange, StateDidLastState
 */
export class UndoHistory {
  constructor(depth, app) {
    const history = this;

    this._depth = depth || 1;
    this._app = app;
    this._nextId = 1;

    this._undoStack = [];
    this._redoStack = [];

    app.listenFor('StateRequestPush', (state) => {
      history.pushUndoState(state);
    });
    app.listenFor('StateRequestUndo', () => {
      history.popUndoState();
    });
    app.listenFor('StateRequestRedo', () => {
      history.shiftRedoState();
    });
    app.listenFor('StateRequestClearAll', () => {
      history.clearAllState();
    });
    app.listenFor('StateRequestLastState', () => {
      app.fireEvent('StateDidLastState', history.getLastUndoState());
    });
  }

  getLastUndoState() {
    return this._undoStack[this._undoStack.length - 1];
  }

  pushUndoState(state) {
    if (!state) return false;

    if (!state.id) state.id = ++this._nextId;
    if (this._undoStack.length >= this._depth) this._undoStack.shift();

    // Discard stale stacks when the pushed state is not contiguous.
    if (this._undoStack.length > 0) {
      if (this._undoStack[this._undoStack.length - 1].id !== state.id - 1) {
        this._undoStack = [];
      }
    }
    if (this._redoStack.length > 0) {
      if (this._redoStack[0].id !== state.id + 1) {
        this._redoStack = [];
      }
    }

    this._undoStack.push(state);

    this._app.fireEvent('StatePush', this._undoStack.length);
    this._app.fireEvent('DidStateChange', this._undoStack, this._redoStack);

    return true;
  }

  popUndoState() {
    const lastState = this._undoStack.pop();

    if (lastState) {
      if (this._redoStack.length > 0) {
        if (this._redoStack[0].id !== lastState.id + 1) {
          this._redoStack = [];
        }
      }

      // Swap: the popped entry moves to the redo stack carrying the buffer
      // that is being replaced, so the edit can be re-applied.
      const currentBuffer = this._app.engine.wavesurfer.backend.buffer;
      this._app.fireEvent('StateDidPop', lastState, 1);

      lastState.data = currentBuffer;
      this._redoStack.unshift(lastState);

      this._app.fireEvent('DidStateChange', this._undoStack, this._redoStack);
    }

    return lastState;
  }

  shiftRedoState() {
    const nextState = this._redoStack.shift();

    if (nextState) {
      if (this._undoStack.length > 0) {
        if (this._undoStack[this._undoStack.length - 1].id !== nextState.id - 1) {
          this._undoStack = [];
        }
      }

      const currentBuffer = this._app.engine.wavesurfer.backend.buffer;
      this._app.fireEvent('StateDidPop', nextState, 0);

      nextState.data = currentBuffer;
      this._undoStack.push(nextState);

      this._app.fireEvent('DidStateChange', this._undoStack, this._redoStack);
    }

    return nextState;
  }

  clearAllState() {
    this._undoStack = [];
    this._redoStack = [];

    this._app.fireEvent('StateClearAll');
    this._app.fireEvent('DidStateChange', [], []);
  }
}
