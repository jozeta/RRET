/* ==========================================================================
   Small UI helpers: non-blocking toasts and inline field validation
   (replaces window.alert(), which blocks the page and the scope — audit UI-003).
   ========================================================================== */

let toastRegion = null;

function region() {
  if (toastRegion && document.body.contains(toastRegion)) return toastRegion;
  toastRegion = document.createElement('div');
  toastRegion.className = 'rret-toast-region';
  toastRegion.setAttribute('role', 'status');
  toastRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastRegion);
  return toastRegion;
}

/**
 * Shows a short, auto-dismissing message.
 * @param {string} message plain text (never HTML)
 * @param {'info'|'success'|'warning'|'error'} type
 */
export function toast(message, type = 'info', timeoutMs = 4500) {
  const el = document.createElement('div');
  el.className = `rret-toast rret-toast-${type}`;
  if (type === 'error') el.setAttribute('role', 'alert');
  el.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'rret-toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => el.remove());
  el.appendChild(close);

  region().appendChild(el);
  if (timeoutMs > 0) setTimeout(() => el.remove(), timeoutMs);
  return el;
}

/** Marks a form field invalid with a message under it; pass '' to clear. */
export function setFieldError(input, message) {
  if (!input) return;
  const id = `${input.id || 'field'}-error`;
  let msg = document.getElementById(id);
  if (!message) {
    input.removeAttribute('aria-invalid');
    if (msg) msg.remove();
    return;
  }
  input.setAttribute('aria-invalid', 'true');
  if (!msg) {
    msg = document.createElement('div');
    msg.id = id;
    msg.className = 'field-error-msg';
    const anchor = input.closest('.input-group') || input;
    anchor.insertAdjacentElement('afterend', msg);
  }
  msg.textContent = message;
  input.setAttribute('aria-describedby', id);
}
