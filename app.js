const API_BASE = localStorage.getItem("redditExtractorApi") || "https://YOUR-WORKER.workers.dev";

let currentData = null;

const $ = id => document.getElementById(id);

function setStatus(msg, error=false) {
  $("status").textContent = msg || "";
  $("status").className = "status" + (error ? " error" : "");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function flattenComments(nodes, out=[]) {
  for (const n of nodes || []) {
    out.push(n);
    flattenComments(n.replies || [], out);
  }
  return out;
}

function renderComment(c) {
  const children = (c.replies || []).map(renderComment).join("");
  const body = c.body ? esc(c.body) : '<span class="deleted">[deleted]</span>';
  return `<div class="comment" data-text="${esc((c.author||"")+" "+(c.body||""))}">
    <div class="commentTop"><b>${esc(c.author || "[deleted]")}</b> · ${c.score ?? 0} points · ${esc(c.created_utc_text || "")}</div>
    <div class="commentBody">${body}</div>
    ${children ? `<div class="commentChildren">${children}</div>` : ""}
  </div>`;
}

function render(data) {
  currentData = data;
  $("results").hidden = false;
  const flat = flattenComments(data.comments);
  $("summary").textContent = `${flat.length.toLocaleString()} comments extracted`;
  $("post").innerHTML = `
    <div class="postTitle">${esc(data.post.title)}</div>
    <div class="meta">r/${esc(data.post.subreddit)} · u/${esc(data.post.author || "[deleted]")} · ${data.post.score ?? 0} points · ${esc(data.post.created_utc_text || "")}</div>
    <div class="body">${data.post.body ? esc(data.post.body) : '<span class="deleted">[no post body]</span>'}</div>`;
  $("comments").innerHTML = data.comments.length ? data.comments.map(renderComment).join("") : '<div class="empty">No comments were returned.</div>';
}

async function extract() {
  const url = $("url").value.trim();
  if (!url) return setStatus("Paste a Reddit post URL.", true);
  if (API_BASE.includes("YOUR-WORKER")) {
    return setStatus("Configure API_BASE in app.js with your deployed worker URL first.", true);
  }
  $("extract").disabled = true;
  setStatus("Fetching post and comments…");
  try {
    const r = await fetch(`${API_BASE}/extract?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `Request failed (${r.status})`);
    render(data);
    setStatus(`Done — ${flattenComments(data.comments).length.toLocaleString()} comments.`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $("extract").disabled = false;
  }
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}
function makeCSV(data) {
  const rows = [["type","id","parent_id","author","score","created_utc","permalink","body","depth"]];
  const walk = (nodes, depth=0) => {
    for (const c of nodes || []) {
      rows.push(["comment",c.id,c.parent_id,c.author,c.score,c.created_utc,c.permalink,c.body,depth]);
      walk(c.replies, depth+1);
    }
  };
  rows.push(["post",data.post.id,"",data.post.author,data.post.score,data.post.created_utc,data.post.permalink,data.post.body,""]);
  walk(data.comments);
  return rows.map(r => r.map(csvEscape).join(",")).join("\n");
}

$("extract").onclick = extract;
$("url").addEventListener("keydown", e => { if(e.key==="Enter") extract(); });
$("copy").onclick = async () => {
  if (!currentData) return;
  await navigator.clipboard.writeText(JSON.stringify(currentData,null,2));
  setStatus("JSON copied to clipboard.");
};
$("json").onclick = () => currentData && download(`reddit-${currentData.post.id}.json`, JSON.stringify(currentData,null,2), "application/json");
$("csv").onclick = () => currentData && download(`reddit-${currentData.post.id}.csv`, makeCSV(currentData), "text/csv");

$("search").oninput = e => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll(".comment").forEach(el => {
    const hit = !q || el.dataset.text.toLowerCase().includes(q);
    el.style.display = hit ? "" : "none";
  });
};
