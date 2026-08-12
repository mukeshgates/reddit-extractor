# Reddit Extractor Final - GitHub only

Upload/replace `index.html`, `style.css`, and `app.js` in your GitHub Pages repository.

This version accepts:
- normal Reddit links: `/comments/POSTID/...`
- Reddit app share links: `/r/subreddit/s/SHARECODE`

No Cloudflare Worker, no Reddit client ID, no secret, no refresh token.

The `/s/` link is a real Reddit share-link format; the share code is not the post ID. Reddit redirects the share link to the canonical post URL, so this version first resolves the redirect and then extracts the post/comments. 

Because GitHub Pages is browser-only, requests are sent through public CORS relays. Those relays can be rate-limited or unavailable. The UI shows progress and errors instead of hanging.


## If the browser still shows `Cannot set properties of null (setting 'oninput')`

That error is from an older `app.js` that expected an element with id `search`.
This fixed version does not use that element at all.

After uploading, do a hard refresh:
- Windows Chrome: Ctrl + Shift + R
- Or open the site in an Incognito window.

You should see in DevTools Console:
`Reddit Extractor: 2026-08-13-github-only-fixed`
