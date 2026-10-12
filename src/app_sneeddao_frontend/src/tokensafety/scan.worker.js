// Web worker: scans a ledger's block log off the main thread so the page
// stays responsive while hundreds of thousands of blocks are decoded.
import { scanLedger } from './scan.js';

self.onmessage = async (e) => {
    const { ledgerId, maxBlocks, timeoutMs, defaultFee } = e.data;
    try {
        const result = await scanLedger(ledgerId, { maxBlocks, timeoutMs, defaultFee, onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }) });
        self.postMessage({ type: 'done', result });
    } catch (err) {
        self.postMessage({ type: 'error', message: err?.message || String(err) });
    }
};
