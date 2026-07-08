/**
 * Lightweight toast notification ("one-up") that floats in, lingers, and fades out.
 */

const ENTER_DELAY_MS = 25;
const DEFAULT_VISIBLE_MS = 720;
const EXIT_DURATION_MS = 330;

/**
 * Show a transient toast message.
 *
 * @param {string} message      HTML content of the toast.
 * @param {number} [visibleMs]  How long the toast stays fully visible.
 * @param {string} [extraClass] Additional CSS class(es) for custom styling.
 */
export function showToast(message, visibleMs, extraClass) {
  const toast = document.createElement('div');

  let className = 'pk_oneup pk_noselect';
  if (extraClass) className += ' ' + extraClass;

  toast.style.cssText = 'margin-top:20px;opacity:0';
  toast.className = className;
  toast.innerHTML = message || '';

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.cssText = 'margin-top:0px;opacity:1';

    setTimeout(() => {
      toast.style.cssText = 'margin-top:-20px;opacity:0';

      setTimeout(() => {
        toast.remove();
      }, EXIT_DURATION_MS);
    }, visibleMs || DEFAULT_VISIBLE_MS);
  }, ENTER_DELAY_MS);
}
