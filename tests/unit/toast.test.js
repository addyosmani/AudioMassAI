import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from '../../src/ui/toast.js';

describe('showToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the message, then fades out and removes itself', () => {
    showToast('Applied Gain (fx)');

    const toast = document.querySelector('.pk_oneup');
    expect(toast).not.toBeNull();
    expect(toast.innerHTML).toBe('Applied Gain (fx)');

    // enter (25ms) + default visible (720ms) + exit (330ms)
    vi.advanceTimersByTime(25 + 720 + 330);
    expect(document.querySelector('.pk_oneup')).toBeNull();
  });

  it('honors a custom visible duration', () => {
    showToast('Long toast', 3000);

    vi.advanceTimersByTime(25 + 720 + 330);
    expect(document.querySelector('.pk_oneup')).not.toBeNull();

    vi.advanceTimersByTime(3000);
    expect(document.querySelector('.pk_oneup')).toBeNull();
  });

  it('applies extra CSS classes', () => {
    showToast('Error!', 100, 'pk_r');
    expect(document.querySelector('.pk_oneup').className).toContain('pk_r');
  });
});
