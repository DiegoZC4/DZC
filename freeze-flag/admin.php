<?php
declare(strict_types=1);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) { http_response_code(405); header('Allow: GET, HEAD'); exit; }
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Manage games · Freeze Flag</title>
  <style>
    :root{color-scheme:dark;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#171717;color:#f2f2f2}
    *{box-sizing:border-box}body{margin:0}main{max-width:900px;margin:0 auto;padding:32px 24px 80px}
    a{color:inherit}button,input{font:inherit}button{min-height:44px;padding:8px 14px;border:1px solid #4a4a4a;border-radius:8px;background:#292929;color:inherit;cursor:pointer}
    button:hover:not(:disabled){background:#383838}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #a3c8ff;outline-offset:3px}
    header{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;margin:28px 0 24px}h1{font-size:clamp(26px,4vw,34px);margin:0 0 6px;letter-spacing:-.7px}p{margin:0;color:#b2b2b2}
    .back{font-size:14px;color:#b2b2b2;text-decoration:none}.stats{display:flex;gap:20px;flex-wrap:wrap;padding:16px 0 20px;color:#b2b2b2;border-bottom:1px solid #363636}.stats strong{color:#eee;font-weight:600}
    .toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0}.select{display:inline-flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;font-size:14px}input[type=checkbox]{width:19px;height:19px;accent-color:#ddd;margin:0}
    .delete{border-color:#704646;color:#ffc1be}.table-wrap{overflow-x:auto;border:1px solid #373737;border-radius:12px}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font-size:12px;letter-spacing:.02em;color:#aaa;font-weight:500;background:#202020}td,th{padding:14px 16px;border-bottom:1px solid #333}tbody tr:last-child td{border:0}td:first-child{width:42px;padding-right:0}td:last-child{text-align:right}td a{font-weight:600;text-decoration:none}td a:hover{text-decoration:underline}small{display:block;color:#a5a5a5;font-size:12px}
    .status{font-size:13px;color:#aaa}.status.active{color:#a9c6f1}.status.reserved{color:#e2c599}.empty{padding:30px 20px;text-align:center;color:#aaa}.notice{display:flex;align-items:center;gap:16px;min-height:60px;margin:14px 0;color:#ccc}.notice span{flex:1}.notice.error{color:#ffc1be}.notice[hidden]{display:none}#deleted{margin-top:28px}summary{cursor:pointer;min-height:44px;color:#b2b2b2}#deleted .table-wrap{margin-top:8px}.footnote{margin-top:24px;font-size:13px;color:#969696}.last{font-variant-numeric:tabular-nums}
    .mobile-status{display:none}
    @media(max-width:600px){main{padding:20px 14px 50px}header{gap:12px;margin:20px 0 8px}header p{font-size:14px}header button{font-size:14px;padding:8px 10px}td,th{padding:12px 9px}td{font-size:14px}td button{font-size:14px;padding:8px 10px}.extra,.seat-status{display:none}.mobile-status{display:block}.stats{font-size:14px;gap:14px}.toolbar{gap:8px}.toolbar button{font-size:14px}.select{font-size:13px}.last{font-size:13px}}
  </style>
</head>
<body>
<main>
  <a class="back" href="./#online">← Back to games</a>
  <header><div><h1>Manage games</h1><p>Clear abandoned games from the lobby.</p></div><button id="refresh" type="button">Refresh</button></header>
  <div class="stats" id="stats" aria-live="polite">Loading games…</div>
  <div class="toolbar"><label class="select"><input type="checkbox" id="select-empty">Select empty games</label><button class="delete" id="delete-selected" type="button" disabled>Delete selected</button></div>
  <div class="table-wrap"><table aria-label="Online games"><thead><tr><th><span aria-hidden="true"></span></th><th>Game</th><th class="seat-status">Status</th><th>Last played</th><th></th></tr></thead><tbody id="games"></tbody></table></div>
  <div class="notice" id="notice" role="status" aria-live="polite" hidden><span></span><button id="undo" type="button" hidden>Undo</button></div>
  <details id="deleted"><summary>Deleted games <span id="deleted-count"></span></summary><div class="table-wrap"><table aria-label="Deleted games"><thead><tr><th>Game</th><th class="extra">Last played</th><th>Deleted</th><th></th></tr></thead><tbody id="deleted-games"></tbody></table></div></details>
  <p class="footnote">Games with connected players or reserved seats are protected. A closed tab releases its seat after two minutes. Deleted games keep their board and history, so you can restore them here.</p>
</main>
<script>
(() => {
  const $ = id => document.getElementById(id);
  let rooms = [], selected = new Set(), undo = [], busy = false, loading = false;
  const gameName = id => `Game ${id.toUpperCase()}`;
  const occupied = room => room.seats.some(seat => seat.claimed);
  const active = () => rooms.filter(room => !room.deletedAt);
  const empty = () => active().filter(room => !occupied(room));
  const absoluteDate = value => new Date(value * 1000).toLocaleString();
  function age(value) {
    if (!Number.isFinite(value)) return 'Unknown';
    const seconds = Math.max(0, Date.now()/1000-value);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
    return `${Math.floor(seconds/86400)}d ago`;
  }
  function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if(cls) el.className = cls; return el; }
  function button(text, action, disabled = false, cls = '') { const el=node('button',text,cls);el.type='button';el.disabled=disabled;el.addEventListener('click',action);return el; }
  function dateCell(value) { const td=node('td',age(value),'last');td.title=absoluteDate(value);return td; }
  function notify(message, error = false) { $('notice').hidden=false;$('notice').classList.toggle('error',error);$('notice').querySelector('span').textContent=message;$('undo').hidden=!undo.length;$('undo').disabled=busy; }
  async function api(action, extra = {}) {
    const response = await fetch('api.php', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra}),cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
    const data=await response.json();if(!response.ok || !data.ok) throw new Error(data.error || 'Could not reach the game server.');return data;
  }
  function controls() {
    const available = empty();
    $('select-empty').disabled=busy || loading || !available.length;
    $('select-empty').checked=available.length>0 && available.every(room=>selected.has(room.id));
    $('select-empty').indeterminate=selected.size>0 && !$('select-empty').checked;
    $('delete-selected').disabled=busy || !selected.size;
    $('delete-selected').textContent=selected.size?`Delete selected (${selected.size})`:'Delete selected';
    $('refresh').disabled=busy || loading;$('undo').disabled=busy;
  }
  function render() {
    const current=active(), deleted=rooms.filter(room=>room.deletedAt), available=empty();
    selected=new Set([...selected].filter(id=>available.some(room=>room.id===id)));
    $('stats').replaceChildren(node('span',`${current.length} ${current.length===1?'game':'games'}`),node('strong',`${available.length} empty`),node('span',`${current.length-available.length} occupied`));
    $('games').replaceChildren();$('deleted-games').replaceChildren();
    for(const room of current) {
      const tr=node('tr'), pick=node('td'), checkbox=node('input');checkbox.type='checkbox';checkbox.checked=selected.has(room.id);checkbox.disabled=busy || occupied(room);checkbox.setAttribute('aria-label',`Select ${gameName(room.id)}`);
      checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(room.id);else selected.delete(room.id);controls();});pick.append(checkbox);tr.append(pick);
      const count=room.seats.filter(seat=>seat.online).length, claimed=room.seats.filter(seat=>seat.claimed).length;
      const status=count?`${count} online`:claimed?'Reserved':'Empty',statusClass=`status ${count?'active':claimed?'reserved':''}`;
      const name=node('td'), link=node('a',gameName(room.id));link.href=`./${encodeURIComponent(room.id)}`;name.append(link,node('small',`${room.playersPerTeam} pawns per team`,'extra'),node('small',status,`${statusClass} mobile-status`));tr.append(name);
      tr.append(node('td',status,`${statusClass} seat-status`),dateCell(room.updatedAt));
      const action=node('td');const del=button('Delete',()=>change('room_delete',[room]),busy||occupied(room),'delete');del.setAttribute('aria-label',`Delete ${gameName(room.id)}`);if(occupied(room))del.title='Wait for both seats to become empty';action.append(del);tr.append(action);$('games').append(tr);
    }
    for(const room of deleted) {
      const tr=node('tr'), name=node('td',gameName(room.id)), played=dateCell(room.updatedAt);played.classList.add('extra');tr.append(name,played,dateCell(room.deletedAt));
      const action=node('td'), restore=button('Restore',()=>change('room_restore',[room]),busy);restore.setAttribute('aria-label',`Restore ${gameName(room.id)}`);action.append(restore);tr.append(action);$('deleted-games').append(tr);
    }
    for(const [id,count,columns,text] of [['games',current.length,5,'No games in the lobby.'],['deleted-games',deleted.length,4,'No deleted games.']]) if(!count){const tr=node('tr'),td=node('td',text,'empty');td.colSpan=columns;tr.append(td);$(id).append(tr);}
    $('deleted-count').textContent=`(${deleted.length})`;controls();
  }
  async function refresh() {
    if(loading)return;loading=true;controls();
    try {rooms=(await api('rooms_manage')).rooms;render();}
    catch(error){notify(error.message,true);}
    finally{loading=false;controls();}
  }
  async function change(action, targets) {
    if(busy || loading)return;busy=true;render();let completed=[],failures=[];
    try {
      for(const room of targets) {
        try {const data=await api(action,{room:room.id,revision:room.revision});completed.push(data.room);rooms=rooms.map(old=>old.id===data.room.id?data.room:old);selected.delete(room.id);}
        catch(error){failures.push(`${gameName(room.id)}: ${error.message}`);}
      }
      if(action==='room_delete' && completed.length) undo=completed.map(room=>room.id);
      if(action==='room_restore') undo=undo.filter(id=>!completed.some(room=>room.id===id));
      const verb=action==='room_delete'?'Deleted':'Restored';
      notify([completed.length?`${verb} ${completed.length===1?gameName(completed[0].id):`${completed.length} games`}.`:'',...failures].filter(Boolean).join(' '),!!failures.length);
    } finally {busy=false;await refresh();render();}
  }
  $('select-empty').addEventListener('change',()=>{selected=$('select-empty').checked?new Set(empty().map(room=>room.id)):new Set();render();});
  $('delete-selected').addEventListener('click',()=>change('room_delete',empty().filter(room=>selected.has(room.id))));
  $('refresh').addEventListener('click',refresh);
  $('undo').addEventListener('click',()=>change('room_restore',rooms.filter(room=>undo.includes(room.id)&&room.deletedAt)));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)void refresh();});
  setInterval(()=>{if(!document.hidden&&!busy&&!selected.size)void refresh();},15000);
  void refresh();
})();
</script>
</body>
</html>
