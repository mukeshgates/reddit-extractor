# Reddit Extractor — GitHub-only version

This version requires ONLY GitHub Pages.

Upload these files to the root of your repository:
- index.html
- style.css
- app.js

No Cloudflare Worker and no API credentials.

IMPORTANT:
Reddit has tightened unauthenticated public API access. Direct `.json` requests can return 403. This version tries the direct Reddit endpoint and then two public CORS proxy services. Those services are outside your GitHub repository and may be rate-limited or stop working.

If all methods fail, the page shows the reason instead of hanging.

For reliable long-term extraction of all comments, an authorized Reddit API/server-side service is required.
