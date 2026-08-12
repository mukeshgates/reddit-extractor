/*
  Cloudflare Worker backend for Reddit Extractor.

  Required Worker secrets:
    REDDIT_CLIENT_ID
    REDDIT_CLIENT_SECRET
    REDDIT_REFRESH_TOKEN
    REDDIT_USER_AGENT

  Set CORS_ALLOWED_ORIGIN to your GitHub Pages origin, e.g.
    https://mukeshgates.github.io
*/

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function response(data, status=200, origin="*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...jsonHeaders, "access-control-allow-origin": origin,
      "access-control-allow-methods":"GET,OPTIONS",
      "access-control-allow-headers":"content-type"}
  });
}

function parsePostUrl(raw) {
  const u = new URL(raw);
  if (!/(^|\\.)reddit\\.com$/i.test(u.hostname) && !/(^|\\.)redd\\.it$/i.test(u.hostname)) {
    throw new Error("That is not a Reddit URL.");
  }
  const m = u.pathname.match(/\\/comments\\/([a-z0-9]+)/i);
  if (!m) throw new Error("Could not find a Reddit post ID in that URL.");
  return m[1];
}

async function getToken(env) {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET || !env.REDDIT_REFRESH_TOKEN) {
    throw new Error("Reddit API credentials are not configured on the Worker.");
  }
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method:"POST",
    headers:{
      "Authorization":`Basic ${basic}`,
      "Content-Type":"application/x-www-form-urlencoded",
      "User-Agent":env.REDDIT_USER_AGENT || "reddit-extractor/1.0"
    },
    body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(env.REDDIT_REFRESH_TOKEN)}`
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`Reddit token request failed (${r.status}).`);
  return d.access_token;
}

async function redditFetch(path, token, env) {
  const r = await fetch(`https://oauth.reddit.com${path}`, {
    headers:{
      "Authorization":`Bearer ${token}`,
      "User-Agent":env.REDDIT_USER_AGENT || "reddit-extractor/1.0"
    }
  });
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch { d = null; }
  if (!r.ok) throw new Error(`Reddit API returned ${r.status}: ${d?.message || text.slice(0,180)}`);
  return d;
}

function listingChildren(listing) {
  return listing?.data?.children || [];
}

function normalizeComment(c) {
  const d = c.data;
  return {
    id:d.id, parent_id:d.parent_id, author:d.author,
    body:d.body || "", score:d.score ?? 0,
    created_utc:d.created_utc,
    created_utc_text:new Date((d.created_utc||0)*1000).toISOString(),
    permalink:d.permalink ? `https://www.reddit.com${d.permalink}` : "",
    replies:[]
  };
}

async function extractAllComments(postId, token, env) {
  // Initial listing. limit=500 is the largest normal listing size.
  const listings = await redditFetch(`/comments/${postId}?raw_json=1&limit=500&depth=10&sort=top`, token, env);
  const commentListing = listings[1];
  const roots = [];
  const byId = new Map();
  const more = [];

  function ingestChildren(children) {
    for (const child of children || []) {
      if (child.kind === "t1") {
        const c = normalizeComment(child);
        byId.set(c.id, c);
        const p = c.parent_id?.replace(/^t[01]_/, "");
        const parent = p && byId.get(p);
        if (parent) parent.replies.push(c);
        else roots.push(c);
        if (child.data?.replies?.data?.children) ingestChildren(child.data.replies.data.children);
      } else if (child.kind === "more") {
        for (const id of child.data?.children || []) more.push(id);
      }
    }
  }
  ingestChildren(listingChildren(commentListing));

  // Expand "more comments". Reddit's API caps each morechildren request.
  // Keep requesting until there are no more IDs or the API rejects the request.
  while (more.length) {
    const batch = more.splice(0, 100);
    const d = await redditFetch(
      `/api/morechildren?api_type=json&raw_json=1&link_id=t3_${postId}&children=${encodeURIComponent(batch.join(","))}&sort=top`,
      token, env
    );
    const things = d?.json?.data?.things || [];
    ingestChildren(things);
  }

  return roots;
}

async function main(request, env) {
  const origin = env.CORS_ALLOWED_ORIGIN || "*";
  if (request.method === "OPTIONS") {
    return new Response(null,{status:204,headers:{
      "access-control-allow-origin":origin,
      "access-control-allow-methods":"GET,OPTIONS",
      "access-control-allow-headers":"content-type"
    }});
  }
  const u = new URL(request.url);
  if (u.pathname !== "/extract") return response({ok:false,error:"Use /extract?url=<reddit-post-url>"},404,origin);
  try {
    const postId = parsePostUrl(u.searchParams.get("url") || "");
    const token = await getToken(env);
    const listings = await redditFetch(`/comments/${postId}?raw_json=1&limit=500&depth=10&sort=top`, token, env);
    const post = listingChildren(listings[0])[0]?.data;
    if (!post) throw new Error("Post not found or inaccessible.");

    const comments = await extractAllComments(postId, token, env);
    return response({
      ok:true,
      post:{
        id:post.id,title:post.title,body:post.selftext||"",
        author:post.author,subreddit:post.subreddit,
        score:post.score,created_utc:post.created_utc,
        created_utc_text:new Date((post.created_utc||0)*1000).toISOString(),
        permalink:`https://www.reddit.com${post.permalink||""}`
      },
      comments
    },200,origin);
  } catch(e) {
    return response({ok:false,error:e.message||"Unknown error"},400,origin);
  }
}

export default {fetch: (request, env) => main(request, env)};
