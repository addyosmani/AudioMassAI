import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextMenu } from '../../src/ui/context-menu.js';

function clickOutside() {
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

function fakeOpenEvent(target) {
  return {
    preventDefault() {},
    stopPropagation() {},
    pageX: 40,
    pageY: 40,
    target,
  };
}

describe('ContextMenu', () => {
  let host;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    // Close any menu left open before the DOM is reset, so the module's
    // internal open-menu registry never points at detached nodes.
    clickOutside();
  });

  it('opens with its registered options and runs callbacks on click', () => {
    const onCopy = vi.fn();
    const menu = new ContextMenu(host);
    menu.addOption('Copy', onCopy);

    menu.open(fakeOpenEvent(host));

    const rendered = document.querySelector('.pk_contextMenu');
    expect(rendered).not.toBeNull();

    const action = rendered.querySelector('.pk_ctx_action');
    expect(action.innerHTML).toBe('Copy');

    action.click();
    expect(onCopy).toHaveBeenCalledTimes(1);
    // choosing an option closes the menu
    expect(document.querySelector('.pk_contextMenu')).toBeNull();
  });

  it('renders raw HTML entries', () => {
    const menu = new ContextMenu(host);
    menu.addOption('ignored', null, '<b>custom</b>');

    menu.open(fakeOpenEvent(host));
    expect(document.querySelector('.pk_contextMenu b').textContent).toBe('custom');
  });

  it('closes on outside mousedown', () => {
    const menu = new ContextMenu(host);
    menu.addOption('Copy', () => {});
    menu.open(fakeOpenEvent(host));

    clickOutside();
    expect(document.querySelector('.pk_contextMenu')).toBeNull();
  });

  it('opens via the custom pk_ctxmn event on the bound element', () => {
    const menu = new ContextMenu(host);
    menu.addOption('Paste', () => {});

    host.dispatchEvent(new Event('pk_ctxmn'));
    expect(document.querySelector('.pk_contextMenu')).not.toBeNull();
  });
});
