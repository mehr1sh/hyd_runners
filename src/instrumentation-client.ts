import { z } from "zod";

/**
 * Runs in the browser before any app code. Zod 4 probes for `eval` support
 * with `new Function("")` the first time it parses an object, so it can
 * compile faster parsers. The app's Content Security Policy does not allow
 * `'unsafe-eval'` (src/lib/security/headers.ts), so turn the JIT off and the
 * probe never runs. Client-side schemas are small; the speed-up is not needed.
 */
z.config({ jitless: true });
