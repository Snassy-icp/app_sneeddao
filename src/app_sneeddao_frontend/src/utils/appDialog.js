// In-app replacements for the browser's alert / confirm / prompt (the app shows no JS popups).
// Any code, React or not, can await these; <AppDialogHost /> (mounted once in App.jsx) renders
// them one at a time with the app's ConfirmDialog.
//
//   await appAlert('Saved', { type: 'success' });
//   if (!(await appConfirm('Delete this?', { type: 'warning', confirmText: 'Delete', confirmVariant: 'danger' }))) return;
//   const v = await appPrompt('New value', 'default');   // string, or null when cancelled
//
// If no host is mounted (tests, a bare page) alerts resolve at once, confirms and prompts resolve
// to "no": an action never runs without a visible yes.

const queue = [];
let listener = null;

function push(req) {
    return new Promise((resolve) => {
        if (!listener) { resolve(req.kind === 'alert' ? undefined : (req.kind === 'confirm' ? false : null)); return; }
        queue.push({ ...req, resolve });
        listener();
    });
}

const asText = (m) => (m instanceof Error ? m.message : m);

export const appAlert = (message, opts = {}) => push({ kind: 'alert', message: asText(message), ...opts });
export const appConfirm = (message, opts = {}) => push({ kind: 'confirm', message: asText(message), ...opts });
export const appPrompt = (message, defaultValue = '', opts = {}) => push({ kind: 'prompt', message: asText(message), defaultValue: String(defaultValue ?? ''), ...opts });

/** For AppDialogHost only. */
export function subscribeAppDialogs(fn) {
    listener = fn;
    return () => { if (listener === fn) listener = null; };
}
export const peekAppDialog = () => queue[0] || null;
export function settleAppDialog(value) {
    const req = queue.shift();
    if (req) req.resolve(value);
    listener?.();
}
