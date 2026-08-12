/*
 Reddit Extractor - GitHub Pages only.

 This version deliberately does NOT use Reddit's .json endpoints.
 Reddit shut down unauthenticated JSON access in 2026, so this version uses
 Reddit's public RSS representation of a post through a browser CORS proxy.

 Flow:
   GitHub Pages -> CorsProxy.io -> Reddit .rss

 No Cloudflare. No Reddit credentials. No API key.
*/

const PROXY="https://corsproxy.io/?url=";
let currentData=null;
const $=id=>document.getElementById(id);

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setStatus(text,count="",pct=5,error=false){
  $("status").hidden=false;$("statusText").textContent=text;$("statusText").className=error?"error":"";
  $("statusCount").textContent=count;$("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}
function log(text){const x=document.createElement("div");x.textContent="• "+text;$("log").appendChild(x);$("log").scrollTop=$("log").scrollHeight;}
function flatten(nodes,out=[]){for(const c of nodes||[]){out.push(c);flatten(c.replies,out)}return out;}

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

/*
 Turn:
 /r/sub/comments/id/title/?foo=bar
 into:
 /r/sub/comments/id/title/.rss?limit=100

 For /s/ links, Reddit is asked to resolve the share URL itself by requesting
 the RSS representation of the share URL.
*/
function makeRSS(info){
  if(info.kind==="share"){
    return `https://www.reddit.com${info.url.pathname}.rss?limit=100`;
  }

  let path=info.url.pathname.replace(/\/+$/,"");
  if(!/\.rss$/i.test(path))path+=".rss";
  return `https://www.reddit.com${path}?limit=100`;
}

async function fetchRSS(target){
  const proxied=PROXY+encodeURIComponent(target);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const r=await fetch(proxied,{method:"GET",headers:{"Accept":"application/rss+xml, application/xml, text/xml, text/plain"}});
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
function parseRSS(xmlText,sourceUrl){
  const parser=new DOMParser();
  const doc=parser.parseFromString(xmlText,"application/xml");
  if(doc.querySelector("parsererror"))throw Error("Reddit returned invalid RSS/XML.");

  const entries=[...doc.querySelectorAll("entry")];
  if(!entries.length)throw Error("RSS feed contained no post/comments.");

  /*
   Reddit's post comments RSS commonly has one submission entry followed by
   comment entries. We use the first entry as the post and the rest as comments.
  */
  const first=entries[0];
  const postTitle=textOf(first,"title");
  const postLink=first.querySelector("link")?.getAttribute("href")||sourceUrl;
  const author=textOf(first,"author name")||textOf(first,"author");
  const content=decodeHTML(textOf(first,"content"));

  let subreddit="";
  const postMatch=postLink.match(/\/r\/([^/]+)/i);
  if(postMatch)subreddit=postMatch[1];

  const comments=[];
  const byId=new Map();

  for(let i=1;i<entries.length;i++){
    const e=entries[i];
    const link=e.querySelector("link")?.getAttribute("href")||"";
    const id=(e.querySelector("id")?.textContent||"").trim();
    const body=decodeHTML(textOf(e,"content"));
    const a=textOf(e,"author name")||textOf(e,"author")||"[deleted]";
    const c={
      id:id||link,
      parent_id:"",
      author:a,
      body:stripRSSHTML(body),
      score:0,
      permalink:link,
      replies:[]
    };
    comments.push(c);byId.set(c.id,c);
  }

  /*
   RSS does not expose the full Reddit tree reliably. Keep comments flat when
   parent information is unavailable rather than inventing nesting.
  */
  return {
    ok:true,
    rss:true,
    post:{
      id:(postLink.match(/\/comments\/([a-z0-9]+)/i)||[])[1]||"",
      title:stripRSSHTML(postTitle),
      body:stripRSSHTML(content),
      author,
      subreddit,
      score:0,
      permalink:postLink
    },
    comments
  };
}

function stripRSSHTML(s){
  const div=document.createElement("div");
  div.innerHTML=s;
  return (div.textContent||div.innerText||s).trim();
}

function renderComment(c){
  return `<div class="comment">
    <div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b>${c.score?` · ${c.score} points`:""}</div>
    <div class="comment-body">${c.body?esc(c.body):'<span class="deleted">[deleted]</span>'}</div>
    ${c.replies?.length?`<div class="children">${c.replies.map(renderComment).join("")}</div>`:""}
  </div>`;
}

function render(data){
  currentData=data;
  const all=flatten(data.comments);
  $("results").hidden=false;$("actions").hidden=false;
  $("commentCount").textContent=`${all.length.toLocaleString()} returned by RSS`;
  $("post").innerHTML=`
    <div class="post-title">${esc(data.post.title)}</div>
    <div class="meta">r/${esc(data.post.subreddit||"")} · u/${esc(data.post.author||"[unknown]")}</div>
    <div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body in RSS]</span>'}</div>`;
  $("comments").innerHTML=data.comments.length
    ?data.comments.map(renderComment).join("")
    :"<div>Reddit did not return comments in the RSS feed.</div>";
}

async function extract(){
  const raw=$("url").value.trim();
  $("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  if(!raw){setStatus("Paste a Reddit post URL first","",0,true);return}
  let info;
  try{info=redditInfo(raw)}catch(e){setStatus(e.message,"",0,true);return}

  $("extract").disabled=true;
  try{
    setStatus("Preparing Reddit RSS feed…","",8);
    log("GitHub-only mode: using Reddit's RSS representation.");
    if(info.kind==="share")log("Reddit /s/ share link detected.");

    const target=makeRSS(info);
    log("RSS target prepared.");
    setStatus("Fetching Reddit RSS…","",25);
    log("Requesting the RSS feed through the public CORS proxy.");

    const xml=await fetchRSS(target);
    setStatus("Reading post and comments…","",55);
    log("RSS response received.");

    const data=parseRSS(xml,raw);
    render(data);

    const total=flatten(data.comments).length;
    setStatus("Done",`${total.toLocaleString()} comments returned`,100);
    log(`Extraction complete — ${total.toLocaleString()} comments returned.`);
    if(total===0)log("This Reddit RSS response did not include comments. RSS is intentionally a limited fallback.");
  }catch(e){
    console.error(e);
    setStatus("Extraction failed","",0,true);
    log(e.name==="AbortError"?"Request timed out after 25 seconds.":(e.message||"Unknown error"));
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
$("json").addEventListener("click",()=>currentData&&download(
  `reddit-${currentData.post.id||"extract"}.json`,JSON.stringify(currentData,null,2),"application/json"
));
$("csv").addEventListener("click",()=>currentData&&download(
  `reddit-${currentData.post.id||"extract"}.csv`,makeCSV(currentData),"text/csv"
));
console.log("Reddit Extractor RSS version loaded.");
