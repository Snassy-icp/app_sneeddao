// Runs the block scan in a web worker when one is available (the browser),
// so decoding does not block the page; otherwise scans in this thread
// (node, tests). Kept apart from scan.js so the worker bundle, which imports
// scan.js, never references itself.
import { scanLedger } from './scan.js';

export function scanLedgerOffThread(ledgerId, { maxBlocks, onProgress, timeoutMs } = {}) {
    if (typeof Worker === 'undefined') return scanLedger(ledgerId, { maxBlocks, onProgress, timeoutMs });
    return new Promise((resolve, reject) => {
        let worker;
        try { worker = new Worker(new URL('./scan.worker.js', import.meta.url), { type: 'module' }); } catch (e) { resolve(scanLedger(ledgerId, { maxBlocks, onProgress, timeoutMs })); return; }
        worker.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'progress') onProgress?.(m.done, m.total);
            else if (m.type === 'done') { resolve(m.result); worker.terminate(); }
            else if (m.type === 'error') { reject(new Error(m.message)); worker.terminate(); }
        };
        worker.onerror = (e) => { reject(new Error(e.message || 'scan worker failed')); worker.terminate(); };
        worker.postMessage({ ledgerId, maxBlocks, timeoutMs });
    });
}

