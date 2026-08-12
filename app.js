/*
 Reddit Extractor - GitHub Pages only.
 Supports BOTH:
   /r/subreddit/comments/POSTID/...
   /r/subreddit/s/SHARECODE

 No Reddit credentials and no Cloudflare Worker are required.

 IMPORTANT:
 Browser requests to Reddit can be blocked by CORS. For that reason this
 version uses public CORS relays only as a transport. It does not send
 credentials to them.
*/

let currentData=null;
const APP_VERSION="2026-08-13-github-only-fixed";
const $=id=>document.getElementById(id);
console.log("Reddit Extractor:", APP_VERSION);

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function status(text,count="",pct=5,error=false){
  $("status").hidden=false;$("statusText").textContent=text;$("statusText").className=error?"error":"";
  $("statusCount").textContent=count;$("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}
function log(text){const x=document.createElement("div");x.textContent="• "+text;$("log").appendChild(x);$("log").scrollTop=$("log").scrollHeight;}
function flatten(nodes,out=[]){for(const c of nodes||[]){out.push(c);flatten(c.replies,out)}return out;}

function normalizeComment(x){
  const d=x.data;
  return {id:d.id,parent_id:d.parent_id,author:d.author,body:d.body||"",score:d.score??0,
    created_utc:d.created_utc,created_utc_text:d.created_utc?new Date(d.created_utc*1000).toISOString():"",
    permalink:d.permalink?`https://www.reddit.com${d.permalink}`:"",replies:[]};
}

function parseListing(data){
  if(!Array.isArray(data)||!data[0]||!data[1])throw Error("Reddit returned an unexpected response.");
  const post=data[0]?.data?.children?.[0]?.data;
  if(!post)throw Error("Post was not found or Reddit did not return it.");
  const roots=[],map=new Map(),more=[];
  function ingest(list){
    for(const x of list||[]){
      if(x.kind==="t1"){
        const c=normalizeComment(x);map.set(c.id,c);
        const parent=(c.parent_id||"").replace(/^t[01]_?/,""),p=map.get(parent);
        if(p)p.replies.push(c);else roots.push(c);
        ingest(x.data?.replies?.data?.children);
      }else if(x.kind==="more")for(const id of x.data?.children||[])more.push(id);
    }
  }
  ingest(data[1]?.data?.children||[]);
  return {post,roots,map,more};
}

/* Fetch through a public CORS relay. The relay follows Reddit's /s/ redirect,
   which is exactly what we need for the new Reddit share links. */
async function relayJSON(target, label){
  const urls=[
    `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`
  ];
  let last="";
  for(let i=0;i<urls.length;i++){
    try{
      status(`Opening Reddit via ${label||"public relay"}…`,"",18+i*8);
      log(`Trying public relay ${i+1}`);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      const r=await fetch(urls[i],{signal:controller.signal});
      clearTimeout(timer);
      if(!r.ok)throw Error(`HTTP ${r.status}`);
      const text=await r.text();
      let d;
      try{d=JSON.parse(text)}catch{throw Error("Relay did not return JSON");}
      if(d.contents!==undefined){
        const parsed=typeof d.contents==="string"?JSON.parse(d.contents):d.contents;
        return {data:parsed,raw:d.contents,url:d.url||""};
      }
      return {data:d,raw:text,url:""};
    }catch(e){last=e.message;log(`Relay failed: ${last}`);}
  }
  throw Error("Could not reach Reddit through the public browser relays.");
}

/* Resolve Reddit's modern /s/ share URL. The /s/ code is not the post ID;
   Reddit redirects it to the canonical /comments/ URL. */
async function resolveRedditURL(raw){
  const u=new URL(raw);
  if(!new RegExp('(^|\\.)reddit\\.com$','i').test(u.hostname)&&!new RegExp('(^|\\.)redd\\.it$','i').test(u.hostname))
    throw Error("Please enter a Reddit URL.");

  const comments=u.pathname.match(new RegExp('/comments/([a-z0-9]+)','i'));
  if(comments)return {postId:comments[1],canonical:raw};

  const share=u.pathname.match(new RegExp('/s/([a-z0-9]+)','i'));
  if(!share)throw Error("This does not look like a Reddit post link.");

  status("Resolving Reddit share link…","",8);log("This is a Reddit /s/ share link. Resolving it to the real post…");

  const resolved=await relayJSON(raw,"share link");
  let finalURL=resolved.url||"";

  // AllOrigins normally exposes the final URL in `url`; if not, find the
  // canonical Reddit URL in the returned HTML.
  if(!new RegExp('/comments/([a-z0-9]+)','i').test(finalURL)){
    const html=String(resolved.raw||"");
    const patterns=[
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i
    ];
    for(const re of patterns){
      const m=html.match(re);if(m){finalURL=m[1];break;}
    }
  }
  const m=finalURL.match(new RegExp('/comments/([a-z0-9]+)','i'));
  if(!m)throw Error("Reddit share link could not be resolved. Try opening the link in your browser once, then copy the resulting Reddit URL.");
  log(`Resolved to Reddit post ID ${m[1]}`);
  return {postId:m[1],canonical:finalURL};
}

async function getRedditListing(postId){
  const target=`https://www.reddit.com/comments/${postId}.json?raw_json=1&limit=500&depth=10&sort=top`;
  status("Fetching post and initial comments…","",25);log("Requesting Reddit post data");
  const r=await relayJSON(target,"post data");
  // AllOrigins wraps contents. CodeTabs may return JSON directly.
  return r.data;
}

async function expandMore(postId,more,roots,map){
  let batchNo=0;
  const maxBatches=30;
  while(more.length&&batchNo<maxBatches){
    const batch=more.splice(0,100);batchNo++;
    status("Extracting comment replies…",`${map.size.toLocaleString()} comments`,35+Math.min(55,batchNo*2));
    log(`Fetching reply batch ${batchNo} (${batch.length} comment IDs)`);
    try{
      const target=`https://www.reddit.com/api/morechildren.json?api_type=json&raw_json=1&link_id=t3_${postId}&children=${encodeURIComponent(batch.join(","))}&sort=top`;
      const r=await relayJSON(target,"comment replies");
      const things=r.data?.json?.data?.things||[];
      for(const x of things){
        if(x.kind!=="t1")continue;
        const c=normalizeComment(x);map.set(c.id,c);
        const parent=(c.parent_id||"").replace(/^t[01]_?/,""),p=map.get(parent);
        if(p)p.replies.push(c);else roots.push(c);
      }
      log(`Batch ${batchNo} complete — ${map.size.toLocaleString()} comments total`);
    }catch(e){
      log(`Reply batch ${batchNo} failed: ${e.message}`);
      break;
    }
  }
  if(more.length)log("Stopped additional expansion after the safety limit.");
}

function renderComment(c){
  return `<div class="comment"><div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b> · ${c.score??0} points · ${esc(c.created_utc_text||"")}</div>
  <div class="comment-body">${c.body?esc(c.body):'<span class="deleted">[deleted]</span>'}</div>
  ${c.replies?.length?`<div class="children">${c.replies.map(renderComment).join("")}</div>`:""}</div>`;
}
function render(data){
  currentData=data;const all=flatten(data.comments);$("results").hidden=false;$("actions").hidden=false;
  $("commentCount").textContent=`${all.length.toLocaleString()} extracted`;
  $("post").innerHTML=`<div class="post-title">${esc(data.post.title)}</div>
  <div class="meta">r/${esc(data.post.subreddit)} · u/${esc(data.post.author||"[deleted]")} · ${data.post.score??0} points · ${esc(data.post.created_utc_text||"")}</div>
  <div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body]</span>'}</div>`;
  $("comments").innerHTML=data.comments.length?data.comments.map(renderComment).join(""):"<div>No comments returned.</div>";
}

async function extract(){
  const raw=$("url").value.trim();$("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  if(!raw){status("Paste a Reddit post URL first","",0,true);return}
  $("extract").disabled=true;
  try{
    status("Starting…","",3);log("Starting extraction");
    const {postId}=await resolveRedditURL(raw);
    const listing=await getRedditListing(postId);
    status("Reading post and initial comments…","",32);
    const parsed=parseListing(listing);
    log(`Post found: ${parsed.post.title}`);
    log(`${parsed.map.size.toLocaleString()} comments in initial response`);
    status("Initial comments loaded…",`${parsed.map.size.toLocaleString()} comments`,35);
    await expandMore(postId,parsed.more,parsed.roots,parsed.map);
    const p=parsed.post;
    const result={ok:true,post:{id:p.id,title:p.title,body:p.selftext||"",author:p.author,subreddit:p.subreddit,score:p.score,
      created_utc:p.created_utc,created_utc_text:p.created_utc?new Date(p.created_utc*1000).toISOString():"",
      permalink:`https://www.reddit.com${p.permalink||""}`},comments:parsed.roots};
    render(result);
    const total=flatten(result.comments).length;
    status("Done",`${total.toLocaleString()} comments`,100);log(`Extraction complete — ${total.toLocaleString()} comments`);
  }catch(e){status("Extraction failed","",0,true);log(e.message||"Unknown error")}
  finally{$("extract").disabled=false}
}

function download(name,text,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function csvEsc(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function makeCSV(d){
  const rows=[["type","id","parent_id","author","score","created_utc","permalink","body","depth"]];
  rows.push(["post",d.post.id,"",d.post.author,d.post.score,d.post.created_utc,d.post.permalink,d.post.body,""]);
  const walk=(nodes,depth)=>{for(const c of nodes||[]){rows.push(["comment",c.id,c.parent_id,c.author,c.score,c.created_utc,c.permalink,c.body,depth]);walk(c.replies,depth+1)}};
  walk(d.comments,0);return rows.map(r=>r.map(csvEsc).join(",")).join("\\n");
}
const extractButton=$("extract");
const urlInput=$("url");
const copyButton=$("copy");
const jsonButton=$("json");
const csvButton=$("csv");

if(extractButton) extractButton.addEventListener("click",extract);
if(urlInput) urlInput.addEventListener("keydown",e=>{if(e.key==="Enter")extract()});
if(copyButton) copyButton.addEventListener("click",async()=>{
  if(currentData){
    try{await navigator.clipboard.writeText(JSON.stringify(currentData,null,2));log("JSON copied to clipboard");}
    catch(e){log("Clipboard permission denied — use Download JSON instead.");}
  }
});
if(jsonButton) jsonButton.addEventListener("click",()=>currentData&&download(
  `reddit-${currentData.post.id}.json`,JSON.stringify(currentData,null,2),"application/json"
));
if(csvButton) csvButton.addEventListener("click",()=>currentData&&download(
  `reddit-${currentData.post.id}.csv`,makeCSV(currentData),"text/csv"
));
