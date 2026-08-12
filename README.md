# Reddit Extractor — Jina Reader version

## What to upload
Replace these three files in your GitHub Pages repository:
- index.html
- style.css
- app.js

No Cloudflare Worker and no Reddit credentials are required.

## How it works
The browser sends the Reddit URL to Jina Reader:
`https://r.jina.ai/<reddit-url>`

Jina documents this Reader URL pattern and currently lists a no-API-key rate limit for Reader. Higher limits can use an API key, but this project does not require one.

The app then:
1. accepts normal `/comments/<post-id>/` links
2. accepts Reddit `/s/<share-code>` links
3. resolves the `/s/` link through Reader
4. requests Reddit's JSON listing through Reader
5. extracts the post and comments
6. attempts to expand Reddit `more` comment batches
7. displays progress
8. exports JSON/CSV

## Important limitation
This is still a GitHub Pages-only browser application. It depends on Jina Reader being able to fetch Reddit and on Reddit returning the JSON data to the reader. Deleted/removed comments and comments unavailable to the source cannot be recovered. Very large threads can also hit rate/response limits.
