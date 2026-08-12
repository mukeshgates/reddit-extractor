/*
  GITHUB-ONLY VERSION
  No Cloudflare Worker, no API key, no Reddit credentials.

  NOTE:
  Reddit currently blocks many unauthenticated .json requests. This browser-only
  version tries a few public fetch routes. If Reddit blocks all of them, the
  page will tell you instead of hanging forever.
*/

let currentData = null;
const $ = id => document.getElementById(id);

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function status(text,count="",pct=5,error=false){
  $("status").hidden=false;
  $("statusText").textContent=text;
  $("statusText").className=error?"error":"";
  $("statusCount").textContent=count;
  $("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}

function log(text){
  const x=document.createElement("div");
  x.textContent="• "+text;
  $("log").appendChild(x);
  $("log").scrollTop=$("log").scrollHeight;
}

function getPostId(raw){
  const u=new URL(raw);
  if(!/(^|\\.)reddit\\.com$/i.test(u.hostname) && !/(^|\\.)redd\\.it$/i.test(u.hostname))
    throw new Error("Please enter a Reddit URL.");
  const m=u.pathname.match(/\\/comments\\/([a-z0-9]+)/i);
  if(!m) throw new Error("I couldn't find the Reddit post ID in that URL.");
  return m[1];
}

function flatten(nodes,out=[]){
  for(const c of nodes||[]){out.push(c);flatten(c.replies,out)}
  return out;
}

function normalizeComment(x){
  const d=x.data;
  return {
    id:d.id,
    parent_id:d.parent_id,
    author:d.author,
    body:d.body||"",
    score:d.score??0,
    created_utc:d.created_utc,
    created_utc_text:d.created_utc?new Date(d.created_utc*1000).toISOString():"",
    permalink:d.permalink?`https://www.reddit.com${d.permalink}`:"",
    replies:[]
  };
}

function parseListing(data){
  if(!Array.isArray(data) || !data[0] || !data[1]) throw new Error("Reddit returned an unexpected response.");
  const post=data[0]?.data?.children?.[0]?.data;
  if(!post) throw new Error("Post was not found or Reddit did not return it.");

  const roots=[], map=new Map(), more=[];
  function ingest(list){
    for(const x of list||[]){
      if(x.kind==="t1"){
        const c=normalizeComment(x);
        map.set(c.id,c);
        const parent=(c.parent_id||"").replace(/^t[01]_?/,"");
        const p=map.get(parent);
        if(p)p.replies.push(c); else roots.push(c);
        ingest(x.data?.replies?.data?.children);
      }else if(x.kind==="more"){
        for(const id of x.data?.children||[]) more.push(id);
      }
    }
  }
  ingest(data[1]?.data?.children||[]);
  return {post,roots,map,more};
}

function convert(post,roots){
  return {
    ok:true,
    post:{
      id:post.id,title:post.title,body:post.selftext||"",
      author:post.author,subreddit:post.subreddit,score:post.score,
      created_utc:post.created_utc,
      created_utc_text:post.created_utc?new Date(post.created_utc*1000).toISOString():"",
      permalink:`https://www.reddit.com${post.permalink||""}`
    },
    comments:roots
  };
}

/* Try direct first, then public CORS fetchers. These are third-party public
   services and may change or rate-limit. No credentials are sent to them. */
async function getJSON(url){
  const routes=[
    {name:"Reddit",url},
    {name:"AllOrigins",url:`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`},
    {name:"CodeTabs",url:`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`}
  ];

  let last="";
  for(const route of routes){
    status(`Trying ${route.name}…`,"",20);
    log(`Requesting Reddit data through ${route.name}`);
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),15000);
      const r=await fetch(route.url,{signal:controller.signal,headers:{"Accept":"application/json"}});
      clearTimeout(timer);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const text=await r.text();
      let data;
      try{data=JSON.parse(text)}catch{throw new Error("Response was not JSON");}
      return data;
    }catch(e){
      last=`${route.name}: ${e.message}`;
      log(`${last} — trying next method`);
    }
  }
  throw new Error("Reddit blocked the browser request. GitHub Pages cannot bypass Reddit's current API restrictions without a server/API layer.");
}

async function expandMore(postId,more,roots,map){
  let batchNo=0;
  const maxBatches=30;
  while(more.length && batchNo<maxBatches){
    const batch=more.splice(0,100);
    batchNo++;
    status(`Extracting comment replies…`,`${map.size.toLocaleString()} comments`,35+Math.min(55,batchNo*2));
    log(`Fetching reply batch ${batchNo} (${batch.length} IDs)`);

    let d;
    try{
      const u=`https://www.reddit.com/api/morechildren.json?api_type=json&raw_json=1&link_id=t3_${postId}&children=${encodeURIComponent(batch.join(","))}&sort=top`;
      d=await getJSON(u);
    }catch(e){
      log(`Could not expand this reply batch: ${e.message}`);
      break;
    }

    const things=d?.json?.data?.things||[];
    for(const x of things){
      if(x.kind!=="t1")continue;
      const c=normalizeComment(x);
      map.set(c.id,c);
      const parent=(c.parent_id||"").replace(/^t[01]_?/,"");
      const p=map.get(parent);
      if(p)p.replies.push(c); else roots.push(c);
      // Some returned comments contain their own replies.
      const nested=x.data?.replies?.data?.children||[];
      for(const n of nested){
        if(n.kind==="t1"){
          const nc=normalizeComment(n);
          map.set(nc.id,nc);
          const np=(nc.parent_id||"").replace(/^t[01]_?/,"");
          const npObj=map.get(np);
          if(npObj)npObj.replies.push(nc); else roots.push(nc);
        }
      }
    }
    status(`Extracting comment replies…`,`${map.size.toLocaleString()} comments`,35+Math.min(55,batchNo*2));
  }
  if(more.length) log("Stopped additional expansion to avoid an endless/very large request.");
}

function render(data){
  currentData=data;
  const all=flatten(data.comments);
  $("results").hidden=false;
  $("actions").hidden=false;
  $("commentCount").textContent=`${all.length.toLocaleString()} extracted`;
  $("post").innerHTML=`
    <div class="post-title">${esc(data.post.title)}</div>
    <div class="meta">r/${esc(data.post.subreddit)} · u/${esc(data.post.author||"[deleted]")} · ${data.post.score??0} points · ${esc(data.post.created_utc_text||"")}</div>
    <div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body]</span>'}</div>`;
  $("comments").innerHTML=data.comments.length
    ?data.comments.map(renderComment).join("")
    :"<div>No comments returned.</div>";
}

function renderComment(c){
  return `<div class="comment">
    <div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b> · ${c.score??0} points · ${esc(c.created_utc_text||"")}</div>
    <div class="comment-body">${c.body?esc(c.body):'<span class="deleted">[deleted]</span>'}</div>
    ${c.replies?.length?`<div class="children">${c.replies.map(renderComment).join("")}</div>`:""}
  </div>`;
}

async function extract(){
  const raw=$("url").value.trim();
  $("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  if(!raw){status("Paste a Reddit post URL first","",0,true);return;}

  $("extract").disabled=true;
  try{
    status("Validating Reddit URL…","",5);log("Starting extraction");
    const id=getPostId(raw);

    status("Fetching post and initial comments…","",15);
    log(`Post ID: ${id}`);

    // The normal endpoint. ?raw_json=1 avoids escaped unicode in many responses.
    const endpoint=`https://www.reddit.com/comments/${id}.json?raw_json=1&limit=500&depth=10&sort=top`;
    const data=await getJSON(endpoint);

    status("Reading post and comments…","",30);
    const parsed=parseListing(data);
    log(`Post found: ${parsed.post.title}`);

    status("Initial comments loaded…",`${parsed.map.size.toLocaleString()} comments`,35);
    log(`${parsed.map.size.toLocaleString()} comments available in initial response`);

    await expandMore(id,parsed.more,parsed.roots,parsed.map);

    const result=convert(parsed.post,parsed.roots);
    render(result);
    const total=flatten(result.comments).length;
    status("Done",`${total.toLocaleString()} comments`,100);
    log(`Extraction complete — ${total.toLocaleString()} comments`);
  }catch(e){
    status("Extraction failed","",0,true);
    log(e.message||"Unknown error");
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

$("extract").onclick=extract;
$("url").addEventListener("keydown",e=>{if(e.key==="Enter")extract()});
$("copy").onclick=async()=>{if(currentData){await navigator.clipboard.writeText(JSON.stringify(currentData,null,2));log("JSON copied to clipboard")}};
$("json").onclick=()=>currentData&&download(`reddit-${currentData.post.id}.json`,JSON.stringify(currentData,null,2),"application/json");
$("csv").onclick=()=>currentData&&download(`reddit-${currentData.post.id}.csv`,makeCSV(currentData),"text/csv");
