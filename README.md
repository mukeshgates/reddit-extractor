# Reddit Extractor V3

This version keeps the simple V1 UI and adds live extraction progress.

## GitHub Pages
Replace `index.html`, `style.css`, and `app.js` in your existing repository.

In `app.js`, replace:
`https://YOUR-WORKER.workers.dev`
with your actual Worker URL.

## Cloudflare Worker
Deploy `worker.js` as your Worker.

Secrets:
- REDDIT_CLIENT_ID
- REDDIT_CLIENT_SECRET
- REDDIT_REFRESH_TOKEN
- REDDIT_USER_AGENT

Variable:
- CORS_ALLOWED_ORIGIN = https://mukeshgates.github.io

The Worker streams NDJSON progress events, so the page shows:
- Validating URL
- Authenticating
- Fetching post/comments
- Initial comments loaded
- Expanding comment replies
- Comments extracted so far
- Done / error

The 100 expansion-batch safety cap prevents a huge thread from hanging forever. Increase it if you deliberately want very large threads.
