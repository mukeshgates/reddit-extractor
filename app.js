/*
 Reddit Extractor - GitHub Pages + Jina Reader.
 No Cloudflare. No Reddit credentials. No API key.

 Jina Reader documents the URL-reader pattern:
 https://r.jina.ai/<target-url>

 This version asks Jina to fetch Reddit's JSON listing rather than trying
 to make the browser call reddit.com directly.
*/

const JINA="https://r.jina.ai/";
let currentData=null;
const $=id=>document.getElementById(id);

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setStatus(text,count="",pct=5,error=false){
  $("status").hidden=false;
  $("statusText").textContent=text;
  $("statusText").className=error?"error":"";
  $("statusCount").textContent=count;
  $("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}
function log(text){
  const x=document.createElement("div");x.textContent="• "+text;
  $("log").appendChild(x);$("log").scrollTop=$("log").scrollHeight;
}
function flatten(nodes,out=[]){for(const c of nodes||[]){out.push(c);flatten(c.replies,out)}return out;}

function isRedditUrl(raw){
  try{
    const u=new URL(raw);
    return /(^|\.)reddit\.com$/i.test(u.hostname)||/(^|\.)redd\.it$/i.test(u.hostname);
  }catch{return false}
}

function findPostId(text){
  const m=String(text).match(/\/comments\/([a-z0-9]+)/i);
  return m?m[1]:null;
}

/*
 Fetch any target through Jina Reader.
 Jina's documented reader endpoint is r.jina.ai/<URL>.
 */
async function jina(target, label, percent){
  const endpoint=JINA+target;
  setStatus(label||"Fetching…","",percent||10);
  log("Jina Reader: "+(label||"fetching"));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(endpoint,{
      method:"GET",
      headers:{"Accept":"text/plain"}
    });
    if(!r.ok) throw new Error(`Jina Reader HTTP ${r.status}`);
    const text=await r.text();
    if(!text.trim()) throw new Error("Jina returned an empty response.");
    return text;
  }finally{
    clearTimeout(timer);
  }
}

/*
 Reddit /s/ links redirect. Instead of trying to perform a browser redirect,
 ask Jina to read the share URL and search the returned content for the
 canonical /comments/<id> URL.
 */
async function resolveShare(raw){
  setStatus("Resolving Reddit share link…","",8);
  log("Detected Reddit /s/ share link.");
  const text=await jina(raw,"Resolving Reddit share link…",10);
  const id=findPostId(text);
  if(id){
    log("Resolved post ID: "+id);
    return id;
  }

  // Sometimes the reader response may expose the canonical URL as plain text.
  const decoded=text.replace(/\\u002F/g,"/");
  const id2=findPostId(decoded);
  if(id2){
    log("Resolved post ID: "+id2);
    return id2;
  }

  throw new Error("Jina could not expose the canonical post ID from this Reddit share link. Try the same link after opening it once in Reddit and copying the resulting URL.");
}

async function resolvePost(raw){
  const u=new URL(raw);
  const m=u.pathname.match(/\/comments\/([a-z0-9]+)/i);
  if(m)return m[1];
  const share=u.pathname.match(/\/s\/([a-z0-9]+)/i);
  if(share)return await resolveShare(raw);
  throw new Error("Use a Reddit post URL or Reddit /s/ share URL.");
}

/*
 We request Reddit's JSON listing THROUGH Jina.
 This avoids browser CORS against reddit.com.
 */
async function fetchRedditJSON(postId){
  const target=`https://www.reddit.com/comments/${postId}.json?raw_json=1&limit=500&depth=10&sort=top`;
  const text=await jina(target,"Fetching Reddit post and comments…",25);

  // Jina can return the JSON as plain text. Find the first JSON object/array.
  const start=Math.min(
    ...["[","{"].map(ch=>{const i=text.indexOf(ch);return i<0?Infinity:i})
  );
  if(!Number.isFinite(start)) throw new Error("Jina returned text instead of Reddit JSON.");

  const candidate=text.slice(start).trim();
  try{return JSON.parse(candidate)}catch{}

  // Handle markdown code fences if the reader wrapped the JSON.
  const fenced=candidate.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
  try{return JSON.parse(fenced)}catch{}

  throw new Error("Could not parse Reddit's JSON response returned by Jina.");
}

function normalizeComment(x){
  const d=x.data;
  return {
    id:d.id,parent_id:d.parent_id,author:d.author,body:d.body||"",score:d.score??0,
    created_utc:d.created_utc,
    created_utc_text:d.created_utc?new Date(d.created_utc*1000).toISOString():"",
    permalink:d.permalink?`https://www.reddit.com${d.permalink}`:"",
    replies:[]
  };
}

function parseListing(data){
  if(!Array.isArray(data)||!data[0]||!data[1])throw new Error("Reddit JSON did not contain a post and comment listing.");
  const post=data[0]?.data?.children?.[0]?.data;
  if(!post)throw new Error("Reddit post was not found or is inaccessible.");

  const roots=[],map=new Map(),more=[];
  function ingest(list){
    for(const x of list||[]){
      if(x.kind==="t1"){
        const c=normalizeComment(x);
        map.set(c.id,c);
        const parent=(c.parent_id||"").replace(/^t[01]_?/,"");
        const p=map.get(parent);
        if(p)p.replies.push(c);else roots.push(c);
        ingest(x.data?.replies?.data?.children);
      }else if(x.kind==="more"){
        for(const id of x.data?.children||[])more.push(id);
      }
    }
  }
  ingest(data[1]?.data?.children||[]);
  return {post,roots,map,more};
}

async function expandMore(postId,more,roots,map){
  /*
   Jina can fetch Reddit's morechildren endpoint too. We do a limited number
   of batches so a huge thread cannot run forever.
  */
  let batchNo=0;
  const maxBatches=20;
  while(more.length&&batchNo<maxBatches){
    const batch=more.splice(0,100);batchNo++;
    setStatus("Extracting comment replies…",`${map.size.toLocaleString()} comments`,40+Math.min(50,batchNo*2));
    log(`Fetching reply batch ${batchNo} (${batch.length} IDs)`);

    try{
      const target=`https://www.reddit.com/api/morechildren.json?api_type=json&raw_json=1&link_id=t3_${postId}&children=${encodeURIComponent(batch.join(","))}&sort=top`;
      const text=await jina(target,`Extracting replies — batch ${batchNo}…`,40+Math.min(50,batchNo*2));
      const start=text.indexOf("{");
      if(start<0)throw new Error("No JSON returned for this reply batch.");
      let d;
      try{d=JSON.parse(text.slice(start).trim())}catch{
        d=JSON.parse(text.slice(start).trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
      }
      const things=d?.json?.data?.things||[];
      for(const x of things){
        if(x.kind!=="t1")continue;
        const c=normalizeComment(x);map.set(c.id,c);
        const parent=(c.parent_id||"").replace(/^t[01]_?/,"");
        const p=map.get(parent);
        if(p)p.replies.push(c);else roots.push(c);
      }
      log(`Batch ${batchNo} complete — ${map.size.toLocaleString()} comments total`);
    }catch(e){
      log(`Reply expansion stopped: ${e.message}`);
      break;
    }
  }
  if(more.length)log("Some 'more comments' remained after the safety limit.");
}

function renderComment(c){
  return `<div class="comment">
    <div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b> · ${c.score??0} points · ${esc(c.created_utc_text||"")}</div>
    <div class="comment-body">${c.body?esc(c.body):'<span class="deleted">[deleted]</span>'}</div>
    ${c.replies?.length?`<div class="children">${c.replies.map(renderComment).join("")}</div>`:""}
  </div>`;
}

function render(data){
  currentData=data;
  const all=flatten(data.comments);
  $("results").hidden=false;$("actions").hidden=false;
  $("commentCount").textContent=`${all.length.toLocaleString()} extracted`;
  $("post").innerHTML=`
    <div class="post-title">${esc(data.post.title)}</div>
    <div class="meta">r/${esc(data.post.subreddit)} · u/${esc(data.post.author||"[deleted]")} · ${data.post.score??0} points · ${esc(data.post.created_utc_text||"")}</div>
    <div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body]</span>'}</div>`;
  $("comments").innerHTML=data.comments.length
    ?data.comments.map(renderComment).join("")
    :"<div>No comments returned.</div>";
}

async function extract(){
  const raw=$("url").value.trim();
  $("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  if(!raw){setStatus("Paste a Reddit post URL first","",0,true);return}
  if(!isRedditUrl(raw)){setStatus("That is not a Reddit URL.","",0,true);return}

  $("extract").disabled=true;
  try{
    setStatus("Starting…","",3);log("Starting extraction");
    const postId=await resolvePost(raw);
    log("Post ID: "+postId);

    const listing=await fetchRedditJSON(postId);
    setStatus("Reading post and initial comments…","",35);
    const parsed=parseListing(listing);
    log("Post found: "+parsed.post.title);
    log(`${parsed.map.size.toLocaleString()} comments in initial response`);

    await expandMore(postId,parsed.more,parsed.roots,parsed.map);

    const p=parsed.post;
    const result={
      ok:true,
      post:{
        id:p.id,title:p.title,body:p.selftext||"",author:p.author,
        subreddit:p.subreddit,score:p.score,created_utc:p.created_utc,
        created_utc_text:p.created_utc?new Date(p.created_utc*1000).toISOString():"",
        permalink:`https://www.reddit.com${p.permalink||""}`
      },
      comments:parsed.roots
    };
    render(result);
    const total=flatten(result.comments).length;
    setStatus("Done",`${total.toLocaleString()} comments`,100);
    log(`Extraction complete — ${total.toLocaleString()} comments`);
  }catch(e){
    console.error(e);
    setStatus("Extraction failed","",0,true);
    log(e.name==="AbortError"?"Jina Reader timed out after 30 seconds.":(e.message||"Unknown error"));
  }finally{
    $("extract").disabled=false;
  }
}

function download(name,text,type){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([text],{type}));
  a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function csvEsc(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function makeCSV(d){
  const rows=[["type","id","parent_id","author","score","created_utc","permalink","body","depth"]];
  rows.push(["post",d.post.id,"",d.post.author,d.post.score,d.post.created_utc,d.post.permalink,d.post.body,""]);
  const walk=(nodes,depth)=>{for(const c of nodes||[]){
    rows.push(["comment",c.id,c.parent_id,c.author,c.score,c.created_utc,c.permalink,c.body,depth]);
    walk(c.replies,depth+1);
  }};
  walk(d.comments,0);
  return rows.map(r=>r.map(csvEsc).join(",")).join("\n");
}

$("extract").addEventListener("click",extract);
$("url").addEventListener("keydown",e=>{if(e.key==="Enter")extract()});
$("copy").addEventListener("click",async()=>{
  if(!currentData)return;
  try{await navigator.clipboard.writeText(JSON.stringify(currentData,null,2));log("JSON copied to clipboard")}
  catch{log("Clipboard permission denied — use Download JSON.")}
});
$("json").addEventListener("click",()=>currentData&&download(
  `reddit-${currentData.post.id}.json`,JSON.stringify(currentData,null,2),"application/json"
));
$("csv").addEventListener("click",()=>currentData&&download(
  `reddit-${currentData.post.id}.csv`,makeCSV(currentData),"text/csv"
));
console.log("Reddit Extractor Jina version loaded.");
