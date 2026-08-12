const H=(origin)=>({"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-cache","Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"content-type"});
const send=(ctrl,obj)=>ctrl.enqueue(new TextEncoder().encode(JSON.stringify(obj)+"\n"));
function postId(raw){const u=new URL(raw);if(!/(\.|^)reddit\.com$/i.test(u.hostname)&&!/^redd\.it$/i.test(u.hostname))throw Error("Not a Reddit URL");const m=u.pathname.match(/\/comments\/([a-z0-9]+)/i);if(!m)throw Error("Could not find Reddit post ID");return m[1]}
async function token(e){const basic=btoa(`${e.REDDIT_CLIENT_ID}:${e.REDDIT_CLIENT_SECRET}`);const r=await fetch("https://www.reddit.com/api/v1/access_token",{method:"POST",headers:{"Authorization":`Basic ${basic}`,"Content-Type":"application/x-www-form-urlencoded","User-Agent":e.REDDIT_USER_AGENT||"reddit-extractor/1.0"},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(e.REDDIT_REFRESH_TOKEN)}`});const d=await r.json();if(!r.ok||!d.access_token)throw Error("Reddit authentication failed");return d.access_token}
async function rf(path,t,e){const r=await fetch("https://oauth.reddit.com"+path,{headers:{Authorization:`Bearer ${t}`,"User-Agent":e.REDDIT_USER_AGENT||"reddit-extractor/1.0"}});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(`Reddit API ${r.status}: ${d?.message||"request failed"}`);return d}
const children=x=>x?.data?.children||[];
function norm(x){const d=x.data;return{id:d.id,parent_id:d.parent_id,author:d.author,body:d.body||"",score:d.score??0,created_utc:d.created_utc,created_utc_text:new Date((d.created_utc||0)*1000).toISOString(),permalink:d.permalink?`https://www.reddit.com${d.permalink}`:"",replies:[]}}
async function run(req,e,ctrl){
 const origin=e.CORS_ALLOWED_ORIGIN||"*"; const raw=new URL(req.url).searchParams.get("url")||"";
 try{
  send(ctrl,{type:"progress",message:"Validating Reddit URL…",percent:5});
  const id=postId(raw);
  send(ctrl,{type:"progress",message:"Authenticating with Reddit…",percent:12});
  const t=await token(e);
  send(ctrl,{type:"progress",message:"Fetching post and initial comments…",percent:25});
  const data=await rf(`/comments/${id}?raw_json=1&limit=500&depth=10&sort=top`,t,e);
  const p=children(data[0])[0]?.data;if(!p)throw Error("Post not found or inaccessible");
  const roots=[],map=new Map(),more=[];
  function ingest(list){
   for(const x of list||[]){
    if(x.kind==="t1"){
     const c=norm(x);map.set(c.id,c);
     const parent=c.parent_id?.replace(/^t[01]_*/,""), pc=map.get(parent);
     if(pc)pc.replies.push(c);else roots.push(c);
     ingest(x.data?.replies?.data?.children)
    }else if(x.kind==="more"){for(const id of x.data?.children||[])more.push(id)}
   }
  }
  ingest(children(data[1]));
  send(ctrl,{type:"progress",message:"Initial comments loaded",count:map.size,percent:45});
  let batches=0;
  while(more.length){
   const batch=more.splice(0,100); batches++;
   send(ctrl,{type:"progress",message:`Expanding comment replies (batch ${batches})…`,count:map.size,percent:Math.min(92,45+batches*3)});
   const d=await rf(`/api/morechildren?api_type=json&raw_json=1&link_id=t3_${id}&children=${encodeURIComponent(batch.join(","))}&sort=top`,t,e);
   ingest(d?.json?.data?.things||[]);
   send(ctrl,{type:"progress",message:`Comments extracted so far: ${map.size.toLocaleString()}`,count:map.size,percent:Math.min(94,45+batches*3)});
   if(batches>=100){send(ctrl,{type:"progress",message:"Stopping after 100 expansion batches to prevent an endless request on huge threads.",count:map.size,percent:95});break}
  }
  const result={ok:true,post:{id:p.id,title:p.title,body:p.selftext||"",author:p.author,subreddit:p.subreddit,score:p.score,created_utc:p.created_utc,created_utc_text:new Date((p.created_utc||0)*1000).toISOString(),permalink:`https://www.reddit.com${p.permalink||""}`},comments:roots};
  send(ctrl,{type:"result",data:result});
 }catch(err){send(ctrl,{type:"error",error:err.message||"Unknown error"})}finally{ctrl.close()}
}
export default{fetch(req,e){const origin=e.CORS_ALLOWED_ORIGIN||"*";if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H(origin)});const u=new URL(req.url);if(u.pathname!=="/extract")return new Response("Use /extract?url=...",{status:404});const ts=new TransformStream();run(req,e,ts.writable.getWriter());return new Response(ts.readable,{headers:H(origin)})}}
