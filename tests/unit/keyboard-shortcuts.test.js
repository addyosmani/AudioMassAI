import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyboardShortcuts } from '../../src/ui/keyboard-shortcuts.js';

const SHIFT = 16;
const KEY_Z = 90;

function pressKey(keyCode) {
  const event = new KeyboardEvent('keydown', { bubbles: true });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  document.dispatchEvent(event);
}

function releaseKey(keyCode) {
  const event = new KeyboardEvent('keyup', { bubbles: true });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  document.dispatchEvent(event);
}

describe('KeyboardShortcuts', () => {
  let shortcuts;

  beforeEach(() => {
    shortcuts = new KeyboardShortcuts();
  });

  it('fires a combination callback only when all keys are held', () => {
    const undo = vi.fn();
    shortcuts.addCallback('undo', undo, [SHIFT, KEY_Z]);

    pressKey(KEY_Z);
    expect(undo).not.toHaveBeenCalled();

    releaseKey(KEY_Z);
    pressKey(SHIFT);
    pressKey(KEY_Z);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('stops firing after removeCallback', () => {
    const cb = vi.fn();
    shortcuts.addCallback('combo', cb, [KEY_Z]);
    shortcuts.removeCallback('combo');

    pressKey(KEY_Z);
    expect(cb).not.toHaveBeenCalled();
  });

  it('tracks held keys in keyMap and clears them on keyup', () => {
    pressKey(SHIFT);
    expect(shortcuts.keyMap[SHIFT]).toBe(1);

    releaseKey(SHIFT);
    expect(shortcuts.keyMap[SHIFT]).toBe(0);
  });

  it('resets all held keys when the window loses focus', () => {
    pressKey(SHIFT);
    window.dispatchEvent(new Event('blur'));
    expect(shortcuts.keyMap).toEqual({});
  });

  it('fires single-key callbacks on keypress', () => {
    const cb = vi.fn();
    shortcuts.addSingleCallback('space', cb, 32);

    const event = new KeyboardEvent('keypress', { bubbles: true });
    Object.defineProperty(event, 'keyCode', { value: 32 });
    document.dispatchEvent(event);

    expect(cb).toHaveBeenCalledTimes(1);
  });
});
