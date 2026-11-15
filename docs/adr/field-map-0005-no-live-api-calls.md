# Field Map ADR 0005: no live API calls in the browser

**Status:** accepted, 2026-11-14

The browser tool never calls the API being mapped. You paste or drop responses. Calling a vendor's API from a page means credentials in a browser tab and CORS failures for most APIs, and it would make the tool a connector, which it isn't. A remote `$ref` in a target schema is an error that names it, never a fetch. With the model off, the page makes no request off its own origin (the browser tests fail if it does).

The CLI (v1.1) can fetch with `--url`, reading any auth header from an environment variable that is never written to a file.
