# 4. No backend

Date: 2026-11-09 · Status: accepted

**Decision.** The web app is static. Files are read and queried in the browser. The only outbound request carrying data is a model call the user turns on, reviews in the payload panel and sends with their own key.

**Why.** "Your data doesn't leave your computer" is only believable if there's nowhere for it to go. It also makes hosting free.

**Cost.** Browser memory caps file size (the PRD targets 200 MB); bigger data goes through the CLI.
