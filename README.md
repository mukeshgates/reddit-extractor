# Reddit Extractor — GitHub-only RSS version

Replace:
- index.html
- style.css
- app.js

No Cloudflare. No Reddit client ID. No Reddit secret. No Jina API key.

This version intentionally does NOT use Reddit's unauthenticated `.json` endpoints, because Reddit began blocking unauthenticated JSON access in 2026.

Instead it uses Reddit's `.rss` representation of the post and requests it through CorsProxy.io so a GitHub Pages browser can read it despite CORS.

Supported input:
- normal `/comments/<post-id>/...` Reddit links
- Reddit `/r/subreddit/s/<share-code>` links

Important compromise:
RSS is a limited fallback. It can return the post and a limited set of comments, but it does NOT provide the complete Reddit comment tree the way the authenticated Data API can. Deleted/removed content is also unavailable.

CorsProxy.io currently documents a no-key free development tier for GitHub.io origins. Its public documentation says GitHub.io is a supported development origin. This is a third-party transport service, not a Reddit API credential.
