# Reddit Extractor V2 — GitHub only

Replace:
- index.html
- style.css
- app.js

Features:
- Reddit /comments links
- Reddit /s/ share links
- Top/New/Controversial/Old RSS sort selection
- Optional "Try additional comment feeds" mode
- Deduplicates comments from multiple feeds
- JSON/CSV export
- Live status

Important limitations:
- RSS is currently a constrained fallback. Reddit has tightened unauthenticated RSS rate limits; recent community reports indicate roughly one request per minute in some cases.
- The optional additional-feed mode deliberately waits about 62 seconds between RSS requests. This can take several minutes.
- RSS does not reliably expose comment karma, so this version cannot truthfully filter by an exact karma threshold.
- "Top comments" is the closest GitHub-only option to "positive karma": Reddit's top sort prioritizes highly voted discussion, but RSS does not provide the actual score field.
- This does not guarantee every comment or the complete nested comment tree.
