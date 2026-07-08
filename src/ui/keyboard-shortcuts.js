/**
 * Global keyboard shortcut handling.
 *
 * Tracks which keys are currently held (`keyMap`) and invokes registered
 * callbacks when all keys of a combination are down. `keyMap` is also read
 * directly by the patched wavesurfer regions plugin (shift-selection), so its
 * name and shape must stay stable.
 */
export class KeyboardShortcuts {
  constructor() {
    const shortcuts = this;

    /** Map of keyCode -> 1 while the key is held down. */
    this.keyMap = {};
    /** Callbacks fired when a full key combination is active. */
    this.callbacks = {};
    /** Callbacks bound to single `keypress` events. */
    this.singleCallbacks = {};

    document.addEventListener('keydown', (event) => {
      shortcuts.keyDown(event.keyCode, event);
    });

    document.addEventListener('keyup', (event) => {
      shortcuts.keyUp(event.keyCode);
    });

    document.addEventListener('keypress', (event) => {
      shortcuts.keyPress(event.keyCode, event);
    });

    // If the window loses focus we never get the keyup events; reset.
    window.addEventListener(
      'blur',
      () => {
        shortcuts.keyMap = {};
      },
      false
    );

    // The app provides its own context menu (see context-menu.js).
    document.addEventListener(
      'contextmenu',
      (event) => {
        event.preventDefault();
      },
      false
    );
  }

  /**
   * Register a combination callback.
   *
   * @param {string}   name      Unique name, used to remove the callback later.
   * @param {Function} callback  Invoked as (keyCode, keyMap, event).
   * @param {number[]} keyCodes  All key codes that must be held simultaneously.
   */
  addCallback(name, callback, keyCodes) {
    this.callbacks[name] = {
      keys: keyCodes,
      callback: callback,
    };
  }

  /** Register a callback for a single `keypress` key code. */
  addSingleCallback(name, callback, keyCode) {
    this.singleCallbacks[name] = {
      key: keyCode,
      callback: callback,
    };
  }

  removeCallback(name) {
    this.callbacks[name] = null;
  }

  keyDown(keyCode, event) {
    this.keyMap[keyCode] = 1;

    for (const name in this.callbacks) {
      const registration = this.callbacks[name];
      if (!registration) continue;

      let index = registration.keys.length;
      let allKeysDown = true;
      while (index-- > 0) {
        if (!this.keyMap[registration.keys[index]]) {
          allKeysDown = false;
          break;
        }
      }

      if (allKeysDown && registration.callback) {
        registration.callback(keyCode, this.keyMap, event);
      }
    }
  }

  keyUp(keyCode) {
    this.keyMap[keyCode] = 0;
  }

  keyPress(keyCode, event) {
    for (const name in this.singleCallbacks) {
      const registration = this.singleCallbacks[name];
      if (!registration) continue;

      if (registration.key === keyCode && registration.callback) {
        registration.callback(event);
      }
    }
  }
}
