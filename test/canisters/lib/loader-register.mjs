// Registers the module loader hook that resolves the frontend's `external/`
// and `declarations/` import aliases when running frontend modules in node.
import { register } from 'node:module';
register('./loader-hook.mjs', import.meta.url);
