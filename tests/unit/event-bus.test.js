import { describe, it, expect, vi } from 'vitest';
import { AudioEditor } from '../../src/core/audio-editor.js';

describe('AudioEditor event bus', () => {
  it('delivers events with up to two values', () => {
    const editor = new AudioEditor();
    const heard = [];
    editor.listenFor('DidZoom', (a, b) => heard.push([a, b]));

    editor.fireEvent('DidZoom', 1.5, 'extra');
    expect(heard).toEqual([[1.5, 'extra']]);
  });

  it('returns false when nobody listens', () => {
    const editor = new AudioEditor();
    expect(editor.fireEvent('Nothing')).toBe(false);
  });

  it('runs listeners in registration order', () => {
    const editor = new AudioEditor();
    const order = [];
    editor.listenFor('Evt', () => order.push('first'));
    editor.listenFor('Evt', () => order.push('second'));

    editor.fireEvent('Evt');
    expect(order).toEqual(['first', 'second']);
  });

  it('supports removing a single listener', () => {
    const editor = new AudioEditor();
    const kept = vi.fn();
    const removed = vi.fn();
    editor.listenFor('Evt', kept);
    editor.listenFor('Evt', removed);

    editor.stopListeningFor('Evt', removed);
    editor.fireEvent('Evt');

    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('supports removing all listeners of an event', () => {
    const editor = new AudioEditor();
    const cb = vi.fn();
    editor.listenFor('Evt', cb);

    editor.stopListeningForName('Evt');
    editor.fireEvent('Evt');

    expect(cb).not.toHaveBeenCalled();
  });

  it('keeps working when fireEvent/listenFor are detached (legacy modules do this)', () => {
    const editor = new AudioEditor();
    const { fireEvent, listenFor } = editor;

    const cb = vi.fn();
    listenFor('Evt', cb);
    fireEvent('Evt', 42);

    expect(cb).toHaveBeenCalledWith(42, undefined);
  });

  it('assigns incremental instance ids', () => {
    const a = new AudioEditor();
    const b = new AudioEditor();
    expect(b.id).toBe(a.id + 1);
  });
});
