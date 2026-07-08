/**
 * The AudioMass editor core.
 *
 * Owns the pub/sub event bus every subsystem communicates through, and wires
 * up the UI, audio engine, undo history, recorder, local session storage and
 * the AI transcription feature.
 *
 * An instance is exposed as `window.PKAudioEditor` by main.js because the
 * patched wavesurfer vendor build calls back into it (see public/vendor/).
 */

import { AudioEngine } from '../audio/audio-engine.js';
import { EditorUI } from '../ui/editor-ui.js';
import { registerEffectsUI } from '../ui/effects-ui.js';
import { UndoHistory } from './undo-history.js';
import { Recorder } from '../audio/recorder.js';
import { LocalSessions } from '../storage/local-sessions.js';
import { initTranscription } from '../features/transcription.js';
import { scheduleWelcomeModal } from '../ui/welcome-modal.js';

const UNDO_HISTORY_DEPTH = 4;

let nextEditorId = -1;

export class AudioEditor {
  constructor() {
    /** Root DOM element the editor is mounted into (set by init). */
    this.el = null;

    /** Instance id, used to namespace DOM ids and key-handler names. */
    this.id = ++nextEditorId;

    /** True on touch devices — tooltips and drag-and-drop adapt. */
    this.isMobile = /iphone|ipod|ipad|android/.test(navigator.userAgent.toLowerCase());

    // --- event bus ---------------------------------------------------------
    // Defined as bound closures (not prototype methods) because several
    // modules detach them (`const fire = app.fireEvent`) and call them bare.
    const listenersByEvent = {};

    /** Notify all listeners of an event. Returns false if nobody listens. */
    this.fireEvent = (eventName, value, value2) => {
      const listeners = listenersByEvent[eventName];
      if (!listeners) return false;

      let index = listeners.length;
      while (index-- > 0) {
        listeners[index] && listeners[index](value, value2);
      }
    };

    /**
     * Subscribe to an event. New listeners are unshifted and fireEvent
     * iterates backwards, so listeners run in registration order.
     */
    this.listenFor = (eventName, callback) => {
      if (!listenersByEvent[eventName]) {
        listenersByEvent[eventName] = [callback];
      } else {
        listenersByEvent[eventName].unshift(callback);
      }
    };

    /** Remove a specific listener from an event. */
    this.stopListeningFor = (eventName, callback) => {
      const listeners = listenersByEvent[eventName];
      if (!listeners) return false;

      let index = listeners.length;
      while (index-- > 0) {
        if (listeners[index] && listeners[index] === callback) {
          listeners[index] = null;
          break;
        }
      }
    };

    /** Remove every listener of an event. */
    this.stopListeningForName = (eventName) => {
      if (!listenersByEvent[eventName]) return false;
      listenersByEvent[eventName] = null;
    };
  }

  /**
   * Mount the editor into the element with the given id and boot all
   * subsystems. Returns the editor instance.
   */
  init(elementId) {
    const el = document.getElementById(elementId);
    if (!el) {
      console.log('invalid element');
      return;
    }
    this.el = el;

    // Order matters: the UI builds the DOM that the engine mounts wavesurfer
    // into, and later subsystems reach both through the instance.
    this.ui = new EditorUI(this);
    registerEffectsUI(this);
    this.engine = new AudioEngine(this);
    this.history = new UndoHistory(UNDO_HISTORY_DEPTH, this);
    this.recorder = new Recorder(this);
    this.sessions = new LocalSessions(this);

    initTranscription(this);
    scheduleWelcomeModal(this);

    this._loadSessionFromUrl();

    return this;
  }

  /** Support "?local=<id>" links that reopen a locally saved session. */
  _loadSessionFromUrl() {
    const sessionId = window.location.href.split('local=')[1];
    if (!sessionId) return;

    this.sessions.Init(() => {
      this.sessions.GetSession(sessionId, (record) => {
        if (record && record.id === sessionId) {
          this.engine.LoadDB(record);
        }
      });
    });
  }
}
