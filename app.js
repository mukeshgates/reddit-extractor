/*
 Reddit Extractor V2 - GitHub Pages only.

 Uses Reddit RSS through CorsProxy.io.
 No Cloudflare, no Reddit credentials, no API key.

 IMPORTANT:
 Reddit's current RSS behavior is limited and may be aggressively rate-limited.
 RSS is not a replacement for the authenticated Reddit API. This version can
 combine a few RSS sort views, deduplicate comments, and prefer "top" first.
 It cannot guarantee every comment or exact karma because RSS does not expose
 the full Reddit comment API fields reliably.
*/

const PROXY="https://corsproxy.io/?url=";
const RSS_DELAY_MS=62000; // only used when "additional feeds" is selected
let currentData=null;
const $=id=>document.getElementById(id);

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setStatus(text,count="",pct=5,error=false){
  $("status").hidden=false;$("statusText").textContent=text;$("statusText").className=error?"error":"";
  $("statusCount").textContent=count;$("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}
function log(text){const x=document.createElement("div");x.textContent="• "+text;$("log").appendChild(x);$("log").scrollTop=$("log").scrollHeight;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function redditInfo(raw){
  const u=new URL(raw);
  if(!/(^|\.)reddit\.com$/i.test(u.hostname)&&!/(^|\.)redd\.it$/i.test(u.hostname))
    throw Error("Please enter a Reddit URL.");
  const comments=u.pathname.match(/\/comments\/([a-z0-9]+)/i);
  const share=u.pathname.match(/\/r\/([^/]+)\/s\/([a-z0-9]+)/i);
  if(comments)return {kind:"comments",postId:comments[1],url:u};
  if(share)return {kind:"share",subreddit:share[1],shareCode:share[2],url:u};
  throw Error("Please paste a Reddit post URL or a Reddit /s/ share link.");
}

function makeRSS(info,sort){
  if(info.kind==="share"){
    return `https://www.reddit.com${info.url.pathname}.rss?limit=100&sort=${encodeURIComponent(sort)}`;
  }
  let path=info.url.pathname.replace(/\/+$/,"");
  if(!/\.rss$/i.test(path))path+=".rss";
  return `https://www.reddit.com${path}?limit=100&sort=${encodeURIComponent(sort)}`;
}

async function fetchRSS(target){
  const proxied=PROXY+encodeURIComponent(target);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(proxied,{headers:{"Accept":"application/rss+xml, application/xml, text/xml, text/plain"}});
    if(!r.ok)throw Error(`Proxy HTTP ${r.status}`);
    const text=await r.text();
    if(!text.trim())throw Error("Empty RSS response.");
    return text;
  }finally{clearTimeout(timer)}
}

function textOf(el,tag){
  const x=el.querySelector(tag);
  return x?x.textContent.trim():"";
}
function decodeHTML(s){
  const t=document.createElement("textarea");t.innerHTML=s;return t.value;
}
function stripRSSHTML(s){
  const div=document.createElement("div");div.innerHTML=s;
  return (div.textContent||div.innerText||s).trim();
}

function parseRSS(xmlText,sourceUrl){
  const doc=new DOMParser().parseFromString(xmlText,"application/xml");
  if(doc.querySelector("parsererror"))throw Error("Reddit returned invalid RSS/XML.");
  const entries=[...doc.querySelectorAll("entry")];
  if(!entries.length)throw Error("RSS feed contained no post/comments.");

  const first=entries[0];
  const postLink=first.querySelector("link")?.getAttribute("href")||sourceUrl;
  const comments=[];
  for(let i=1;i<entries.length;i++){
    const e=entries[i];
    const link=e.querySelector("link")?.getAttribute("href")||"";
    const id=(e.querySelector("id")?.textContent||link).trim();
    const body=decodeHTML(textOf(e,"content"));
    comments.push({
      id,parent_id:"",
      author:textOf(e,"author name")||textOf(e,"author")||"[deleted]",
      body:stripRSSHTML(body),
      score:null,
      permalink:link,replies:[]
    });
  }

  const postMatch=postLink.match(/\/r\/([^/]+)/i);
  const idMatch=postLink.match(/\/comments\/([a-z0-9]+)/i);
  return {
    ok:true,
    post:{
      id:idMatch?.[1]||"",
      title:stripRSSHTML(textOf(first,"title")),
      body:stripRSSHTML(decodeHTML(textOf(first,"content"))),
      author:textOf(first,"author name")||textOf(first,"author")||"",
      subreddit:postMatch?.[1]||"",
      score:null,permalink:postLink
    },
    comments
  };
}

function mergeData(base,extra){
  const seen=new Set(base.comments.map(c=>c.id));
  for(const c of extra.comments){
    if(!seen.has(c.id)){base.comments.push(c);seen.add(c.id);}
  }
  return base;
}

function renderComment(c){
  return `<div class="comment">
    <div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b>${c.score!=null?` · ${c.score} points`:""}</div>
    <div class="comment-body">${c.body?esc(c.body):'<span class="deleted">[deleted]</span>'}</div>
  </div>`;
}

function render(data,sort,extraUsed){
  currentData=data;
  $("results").hidden=false;$("actions").hidden=false;
  $("commentCount").textContent=`${data.comments.length.toLocaleString()} returned`;
  const note=extraUsed?`<div class="note">Combined multiple RSS sort views and removed duplicate comments. RSS still cannot guarantee every Reddit comment.</div>`:"";
  $("post").innerHTML=`
    <div class="post-title">${esc(data.post.title)}</div>
    <div class="meta">r/${esc(data.post.subreddit||"")} · u/${esc(data.post.author||"[unknown]")}</div>
    <div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body in RSS]</span>'}</div>`;
  $("comments").innerHTML=note+(data.comments.length
    ?data.comments.map(renderComment).join("")
    :"<div>Reddit did not return comments in this RSS response.</div>");
}

async function extract(){
  const raw=$("url").value.trim();
  $("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  if(!raw){setStatus("Paste a Reddit post URL first","",0,true);return}
  let info;
  try{info=redditInfo(raw)}catch(e){setStatus(e.message,"",0,true);return}

  $("extract").disabled=true;
  try{
    const sort=$("sort").value;
    const extra=$("extra").checked;
    setStatus("Preparing Reddit RSS feed…","",8);
    log("GitHub-only RSS mode.");
    if(info.kind==="share")log("Reddit /s/ share link detected.");
    log(`Primary sort: ${sort}`);

    const primary=await fetchRSS(makeRSS(info,sort));
    setStatus("Reading primary RSS feed…","",35);
    const data=parseRSS(primary,raw);
    log(`Primary feed returned ${data.comments.length} comments.`);

    if(extra){
      const sorts=["top","new","controversial","old"].filter(x=>x!==sort);
      for(let i=0;i<sorts.length;i++){
        log(`Reddit RSS is rate-limited; waiting before the next feed (${Math.ceil(RSS_DELAY_MS/1000)}s).`);
        setStatus(`Waiting for Reddit RSS rate limit…`,`${data.comments.length} comments`,40+i*15);
        await sleep(RSS_DELAY_MS);
        try{
          const xml=await fetchRSS(makeRSS(info,sorts[i]));
          const next=parseRSS(xml,raw);
          data=mergeData(data,next);
          log(`${sorts[i]} feed added ${next.comments.length} items; ${data.comments.length} unique comments total.`);
        }catch(e){log(`${sorts[i]} feed failed: ${e.message}`);}
      }
    }

    render(data,sort,extra);
    setStatus("Done",`${data.comments.length.toLocaleString()} comments returned`,100);
    log(`Extraction complete — ${data.comments.length.toLocaleString()} unique comments.`);
    if(!extra)log("Tip: select “Try additional comment feeds” if you want to combine multiple RSS views. It can take several minutes because Reddit RSS is currently heavily rate-limited.");
  }catch(e){
    console.error(e);
    setStatus("Extraction failed","",0,true);
    log(e.name==="AbortError"?"Request timed out after 30 seconds.":(e.message||"Unknown error"));
  }finally{$("extract").disabled=false}
}

function download(name,text,type){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));
  a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function csvEsc(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function makeCSV(d){
  const rows=[["type","id","parent_id","author","score","permalink","body"]];
  rows.push(["post",d.post.id,"",d.post.author,d.post.score,d.post.permalink,d.post.body]);
  for(const c of d.comments)rows.push(["comment",c.id,c.parent_id,c.author,c.score,c.permalink,c.body]);
  return rows.map(r=>r.map(csvEsc).join(",")).join("\n");
}

$("extract").addEventListener("click",extract);
$("url").addEventListener("keydown",e=>{if(e.key==="Enter")extract()});
$("copy").addEventListener("click",async()=>{
  if(!currentData)return;
  try{await navigator.clipboard.writeText(JSON.stringify(currentData,null,2));log("JSON copied to clipboard")}
  catch{log("Clipboard permission denied — use Download JSON.")}
});
$("json").addEventListener("click",()=>currentData&&download(`reddit-${currentData.post.id||"extract"}.json`,JSON.stringify(currentData,null,2),"application/json"));
$("csv").addEventListener("click",()=>currentData&&download(`reddit-${currentData.post.id||"extract"}.csv`,makeCSV(currentData),"text/csv"));
