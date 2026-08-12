# Reddit Extractor — GitHub-only final

Upload/replace only:
- `index.html`
- `style.css`
- `app.js`

No Cloudflare and no Reddit credentials.

This version uses Jina Reader as the single external fetch layer. Jina's Reader supports `r.jina.ai/<URL>` and documents ReaderLM-v2 structured extraction using `x-respond-with`, `x-json-schema`, and `x-instruction`.

The app sends the Reddit URL directly to Reader, so Reddit `/s/` share URLs do not need a separate redirect-decoding algorithm.

If structured extraction works, the page displays post + comments and exports JSON/CSV.

If structured extraction is unavailable, the app falls back to the readable page content instead of showing a parsing error. This means you still get the data returned by Reader.

The free no-key Reader limit is currently documented by Jina as 20 requests/minute per IP. 
