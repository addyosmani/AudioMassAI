import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimpleModal } from '../../src/ui/modals.js';

describe('SimpleModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders title, body and buttons when shown', () => {
    const modal = new SimpleModal({
      title: 'Export',
      body: '<p>Pick a format</p>',
      buttons: [{ title: 'OK', callback: () => {} }],
    });
    modal.Show();

    expect(document.querySelector('.pk_modal_title').textContent).toContain('Export');
    expect(document.querySelector('.pk_modal_main').innerHTML).toContain('Pick a format');

    const buttons = [...document.querySelectorAll('.pk_modal_a_bottom')].map((b) => b.textContent);
    expect(buttons).toEqual(['CANCEL', 'OK']);
  });

  it('invokes button callbacks with the modal instance', () => {
    const callback = vi.fn();
    const modal = new SimpleModal({
      title: 't',
      buttons: [{ title: 'Apply', callback }],
    }).Show();

    modal.els.bottom[0].click();
    expect(callback).toHaveBeenCalledWith(modal);
  });

  it('runs setup during construction and ondestroy on Destroy', () => {
    const setup = vi.fn();
    const ondestroy = vi.fn();

    const modal = new SimpleModal({ title: 't', setup, ondestroy }).Show();
    expect(setup).toHaveBeenCalledWith(modal);

    modal.Destroy();
    expect(ondestroy).toHaveBeenCalledWith(modal);
    expect(document.querySelector('.pk_modal_back')).toBeNull();
  });

  it('closes via the cancel button', () => {
    new SimpleModal({ title: 't' }).Show();

    document.querySelector('.pk_modal_cancel').click();
    expect(document.querySelector('.pk_modal_back')).toBeNull();
  });

  it('skips buttons without a title or callback', () => {
    new SimpleModal({
      title: 't',
      buttons: [{ title: 'No callback' }, {}, { title: 'Valid', callback: () => {} }],
    }).Show();

    const labels = [...document.querySelectorAll('.pk_modal_a_bottom')].map((b) => b.textContent);
    expect(labels).toEqual(['CANCEL', 'Valid']);
  });
});
