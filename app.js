/*
 GitHub-only Reddit Extractor.

 One request:
 Browser -> Jina Reader -> Reddit

 No Cloudflare, no Reddit credentials, no API_BASE.

 Jina Reader supports ReaderLM-v2 plus x-instruction/x-json-schema for
 structured extraction. We ask it to return a Reddit post and the comments
 it can see. If structured extraction fails, we fall back to normal Reader
 text and show the returned data instead of silently failing.
*/

const JINA="https://r.jina.ai/";
let currentData=null;
const $=id=>document.getElementById(id);

const schema={
  type:"object",
  properties:{
    title:{type:"string"},
    subreddit:{type:"string"},
    author:{type:"string"},
    score:{type:"number"},
    post_body:{type:"string"},
    post_url:{type:"string"},
    comments:{
      type:"array",
      items:{
        type:"object",
        properties:{
          id:{type:"string"},
          author:{type:"string"},
          score:{type:"number"},
          body:{type:"string"},
          permalink:{type:"string"},
          replies:{
            type:"array",
            items:{
              type:"object",
              properties:{
                id:{type:"string"},
                author:{type:"string"},
                score:{type:"number"},
                body:{type:"string"},
                permalink:{type:"string"}
              }
            }
          }
        }
      }
    }
  }
};

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setStatus(text,count="",pct=5,error=false){
  $("status").hidden=false;$("statusText").textContent=text;$("statusText").className=error?"error":"";
  $("statusCount").textContent=count;$("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}
function log(text){const x=document.createElement("div");x.textContent="• "+text;$("log").appendChild(x);$("log").scrollTop=$("log").scrollHeight;}
function flatten(nodes,out=[]){for(const c of nodes||[]){out.push(c);flatten(c.replies,out)}return out;}

function normalizeData(d,sourceUrl){
  const comments=Array.isArray(d.comments)?d.comments:[];
  function clean(c){
    return {
      id:c.id||"",
      parent_id:c.parent_id||"",
      author:c.author||"[deleted]",
      body:c.body||"",
      score:Number.isFinite(Number(c.score))?Number(c.score):0,
      permalink:c.permalink||"",
      replies:Array.isArray(c.replies)?c.replies.map(clean):[]
    };
  }
  return {
    ok:true,
    post:{
      id:(sourceUrl.match(/\/comments\/([a-z0-9]+)/i)||[])[1]||"",
      title:d.title||"Untitled Reddit post",
      body:d.post_body||"",
      author:d.author||"[unknown]",
      subreddit:d.subreddit||"",
      score:Number.isFinite(Number(d.score))?Number(d.score):0,
      permalink:d.post_url||sourceUrl
    },
    comments:comments.map(clean)
  };
}

async function structuredReader(target){
  const endpoint=JINA+target;
  const schemaHeader=JSON.stringify(schema);
  const instruction=`Extract the Reddit post from this page. Return ONLY the requested JSON object. Include the post title, subreddit, author, score, full post body, canonical post URL, and as many Reddit comments as are actually present in the fetched page. For each comment include author, score, body, permalink, and direct replies when visible. Do not invent comments or text. Preserve the exact comment text as closely as possible. If a value is unavailable, use an empty string or 0.`;

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const r=await fetch(endpoint,{
      method:"GET",
      headers:{
        "Accept":"application/json",
        "x-respond-with":"readerlm-v2",
        "x-json-schema":schemaHeader,
        "x-instruction":instruction
      },
      signal:controller.signal
    });
    if(!r.ok)throw new Error(`Jina HTTP ${r.status}`);
    const text=await r.text();
    return text;
  }finally{clearTimeout(timer)}
}

function parsePossibleJSON(text){
  let t=String(text||"").trim();
  try{return JSON.parse(t)}catch{}
  const first=t.indexOf("{"),last=t.lastIndexOf("}");
  if(first>=0&&last>first){
    try{return JSON.parse(t.slice(first,last+1))}catch{}
  }
  return null;
}

async function normalReader(target){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const r=await fetch(JINA+target,{headers:{Accept:"text/plain"},signal:controller.signal});
    if(!r.ok)throw new Error(`Jina HTTP ${r.status}`);
    return await r.text();
  }finally{clearTimeout(timer)}
}

function parseMarkdownFallback(text,sourceUrl){
  /*
   Conservative fallback. We don't invent structure. We display the Reader
   text as one "raw extraction" and also try to identify a title.
  */
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  let title="";
  for(const line of lines){
    if(/^#\s+/.test(line)){title=line.replace(/^#+\s+/,"").trim();break}
  }
  if(!title && lines.length) title=lines[0].replace(/^\*+|\*+$/g,"").trim();

  return {
    ok:true,
    fallback:true,
    post:{
      id:(sourceUrl.match(/\/comments\/([a-z0-9]+)/i)||[])[1]||"",
      title:title||"Reddit extraction",
      body:text,
      author:"",
      subreddit:"",
      score:0,
      permalink:sourceUrl
    },
    comments:[]
  };
}

function renderComment(c){
  return `<div class="comment">
    <div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b> · ${c.score??0} points</div>
    <div class="comment-body">${c.body?esc(c.body):'<span class="deleted">[deleted]</span>'}</div>
    ${c.replies?.length?`<div class="children">${c.replies.map(renderComment).join("")}</div>`:""}
  </div>`;
}

function render(data){
  currentData=data;
  const all=flatten(data.comments);
  $("results").hidden=false;$("actions").hidden=false;
  $("commentCount").textContent=data.fallback
    ?"Reader text returned"
    :`${all.length.toLocaleString()} extracted`;
  $("post").innerHTML=`
    <div class="post-title">${esc(data.post.title)}</div>
    <div class="meta">${data.post.subreddit?"r/"+esc(data.post.subreddit)+" · ":""}${data.post.author?"u/"+esc(data.post.author)+" · ":""}${data.post.score||0} points</div>
    <div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body]</span>'}</div>`;
  if(data.fallback){
    $("comments").innerHTML=`<div><b>Raw Reader content</b><p class="meta">The page was fetched successfully, but structured comment extraction was unavailable. You can still copy/download the returned data.</p><div class="raw">${esc(data.post.body)}</div></div>`;
  }else{
    $("comments").innerHTML=data.comments.length
      ?data.comments.map(renderComment).join("")
      :"<div>No structured comments were returned by the reader.</div>";
  }
}

async function extract(){
  const raw=$("url").value.trim();
  $("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  if(!raw){setStatus("Paste a Reddit post URL first","",0,true);return}
  let u;
  try{u=new URL(raw)}catch{setStatus("Invalid URL.","",0,true);return}
  if(!/(^|\.)reddit\.com$/i.test(u.hostname)&&!/(^|\.)redd\.it$/i.test(u.hostname)){
    setStatus("Please enter a Reddit URL.","",0,true);return
  }

  $("extract").disabled=true;
  try{
    setStatus("Opening Reddit through Reader…","",10);
    log("Sending the Reddit URL to Jina Reader.");
    if(/\/s\/[a-z0-9]+/i.test(u.pathname)) log("Reddit /s/ share link detected — Reader will follow the page redirect.");

    setStatus("Extracting post and comments…","",35);
    const rawResponse=await structuredReader(raw);
    log("Reader returned a structured response.");

    let parsed=parsePossibleJSON(rawResponse);
    if(parsed && parsed.data && typeof parsed.data==="object") parsed=parsed.data;

    if(parsed && (parsed.title!==undefined || parsed.comments!==undefined)){
      const result=normalizeData(parsed,raw);
      render(result);
      const total=flatten(result.comments).length;
      setStatus("Done",`${total.toLocaleString()} comments extracted`,100);
      log(`Finished — ${total.toLocaleString()} structured comments returned.`);
    }else{
      log("Structured response could not be parsed. Falling back to normal Reader text.");
      setStatus("Fetching readable Reddit content…","",60);
      const text=await normalReader(raw);
      const fallback=parseMarkdownFallback(text,raw);
      render(fallback);
      setStatus("Done","Raw page data extracted",100);
      log("The page data was extracted, but Reddit did not expose a structured comment list.");
    }
  }catch(e){
    console.error(e);
    setStatus("Extraction failed","",0,true);
    if(e.name==="AbortError") log("Reader timed out after 45 seconds.");
    else log(e.message||"Unknown error");
  }finally{$("extract").disabled=false}
}

function download(name,text,type){
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));
  a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function csvEsc(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function makeCSV(d){
  const rows=[["type","id","parent_id","author","score","permalink","body","depth"]];
  rows.push(["post",d.post.id,"",d.post.author,d.post.score,d.post.permalink,d.post.body,""]);
  const walk=(nodes,depth)=>{for(const c of nodes||[]){
    rows.push(["comment",c.id,c.parent_id,c.author,c.score,c.permalink,c.body,depth]);
    walk(c.replies,depth+1);
  }};
  walk(d.comments,0);
  if(d.fallback) rows.push(["raw","","","","","","Reader returned raw content; see JSON export.",0]);
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
console.log("Reddit Extractor GitHub-only final loaded.");
