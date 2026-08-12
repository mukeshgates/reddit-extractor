# Reddit Extractor V2

This project uses:
- GitHub Pages for the frontend
- Cloudflare Workers for the backend
- Reddit OAuth/Data API for reading a post and its comments

## 1. Deploy the Worker

Create a Cloudflare Worker and paste `worker.js` into it.

Add Worker secrets:
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_REFRESH_TOKEN`
- `REDDIT_USER_AGENT`

Add a plain Worker variable:
- `CORS_ALLOWED_ORIGIN=https://mukeshgates.github.io`

Your Reddit app must have permission to read the data you request. Reddit's API access policies have changed, so do not assume an old unauthenticated `.json` endpoint will work.

## 2. Connect GitHub Pages

In `app.js`, change:

const API_BASE = "https://YOUR-WORKER.workers.dev";

to your real Worker URL.

Push `index.html`, `style.css`, and `app.js` to the root of your `reddit-extractor` repository.

## 3. Test

Open the GitHub Pages site and paste a post URL.

The response includes:
- title
- body
- author
- subreddit
- score
- created time
- permalink
- nested comments
- replies
- comment author/score/body/time/permalink
- JSON export
- CSV export

## Important

"All comments" means all comments Reddit makes available to the authenticated API account. Deleted/removed content may not be recoverable, and extremely large threads can be subject to Reddit/API limits.
