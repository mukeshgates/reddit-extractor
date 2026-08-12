// Put your Cloudflare Worker URL here:
const API_BASE = "https://YOUR-WORKER.workers.dev";

let currentData = null;
const $ = id => document.getElementById(id);

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function setProgress(text,count="",pct=5){
  $("progress").hidden=false;$("progressText").textContent=text;$("progressCount").textContent=count;
  $("barFill").style.width=Math.max(2,Math.min(100,pct))+"%";
}
function addLog(text){
  const d=document.createElement("div"); d.textContent="• "+text;
  $("log").appendChild(d); $("log").scrollTop=$("log").scrollHeight;
}
function flatten(nodes,out=[]){for(const c of nodes||[]){out.push(c);flatten(c.replies,out)}return out}
function renderComment(c){
  const body=c.body?esc(c.body):'<span class="deleted">[deleted]</span>';
  return `<div class="comment"><div class="comment-meta"><b>${esc(c.author||"[deleted]")}</b> · ${c.score??0} points · ${esc(c.created_utc_text||"")}</div><div class="comment-body">${body}</div>${c.replies?.length?`<div class="children">${c.replies.map(renderComment).join("")}</div>`:""}</div>`;
}
function render(data){
  currentData=data; const all=flatten(data.comments);
  $("results").hidden=false;$("actions").hidden=false;
  $("commentCount").textContent=all.length.toLocaleString()+" extracted";
  $("post").innerHTML=`<div class="post-title">${esc(data.post.title)}</div><div class="meta">r/${esc(data.post.subreddit)} · u/${esc(data.post.author||"[deleted]")} · ${data.post.score??0} points · ${esc(data.post.created_utc_text||"")}</div><div class="body">${data.post.body?esc(data.post.body):'<span class="deleted">[no post body]</span>'}</div>`;
  $("comments").innerHTML=data.comments.length?data.comments.map(renderComment).join(""):"<div>No comments returned.</div>";
}
async function extract(){
  const url=$("url").value.trim();
  if(!url)return setProgress("Paste a Reddit post URL first","",0);
  if(API_BASE.includes("YOUR-WORKER"))return setProgress("Set your Worker URL in app.js first","",0);
  $("extract").disabled=true;$("results").hidden=true;$("actions").hidden=true;$("log").innerHTML="";
  setProgress("Connecting to extractor…","",5);addLog("Validating Reddit URL");
  try{
    const r=await fetch(`${API_BASE}/extract?url=${encodeURIComponent(url)}`);
    if(!r.ok) throw new Error(`Server error ${r.status}`);
    if(!r.body) throw new Error("Streaming is not supported by this browser.");
    const reader=r.body.getReader(), decoder=new TextDecoder(); let buffer="";
    while(true){
      const {value,done}=await reader.read(); if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split("\\n"); buffer=lines.pop();
      for(const line of lines){
        if(!line.trim())continue;
        let msg; try{msg=JSON.parse(line)}catch{continue}
        if(msg.type==="progress"){setProgress(msg.message,msg.count?msg.count.toLocaleString()+" comments":"",msg.percent||10);addLog(msg.message)}
        if(msg.type==="result"){render(msg.data);setProgress("Done",flatten(msg.data.comments).length.toLocaleString()+" comments",100);addLog("Extraction complete")}
        if(msg.type==="error")throw new Error(msg.error)}
    }
  }catch(e){setProgress("Extraction failed","",0);$("progressText").classList.add("error");addLog(e.message)}
  finally{$("extract").disabled=false}
}
function download(name,text,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function csvEsc(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function makeCSV(d){
 const rows=[["type","id","parent_id","author","score","created_utc","permalink","body","depth"]];
 rows.push(["post",d.post.id,"",d.post.author,d.post.score,d.post.created_utc,d.post.permalink,d.post.body,""]);
 const walk=(nodes,depth)=>{for(const c of nodes||[]){rows.push(["comment",c.id,c.parent_id,c.author,c.score,c.created_utc,c.permalink,c.body,depth]);walk(c.replies,depth+1)}};
 walk(d.comments,0);return rows.map(r=>r.map(csvEsc).join(",")).join("\\n")
}
$("extract").onclick=extract;$("url").addEventListener("keydown",e=>{if(e.key==="Enter")extract()});
$("copy").onclick=async()=>{if(currentData){await navigator.clipboard.writeText(JSON.stringify(currentData,null,2));addLog("JSON copied to clipboard")}};
$("json").onclick=()=>currentData&&download(`reddit-${currentData.post.id}.json`,JSON.stringify(currentData,null,2),"application/json");
$("csv").onclick=()=>currentData&&download(`reddit-${currentData.post.id}.csv`,makeCSV(currentData),"text/csv");
