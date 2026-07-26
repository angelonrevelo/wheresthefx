/**
 * Where the API lives.
 *
 * Empty string means same origin, which is the deployed shape: one
 * process serves the built client and the API from one host, so there is
 * no cross-origin request and therefore no CORS to configure, no
 * preflight, and no third-party host to keep in step.
 *
 * `VITE_API_URL` overrides it, for pointing a local client at a remote
 * API. In ordinary development the Vite dev server proxies `/api` to the
 * local API instead, so dev and production behave the same way.
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? '';
