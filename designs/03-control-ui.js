// Phase 3 design prototype. No CLI calls. Browser storage holds demo drafts only.
const style = document.createElement('style');
style.textContent = `
.preview{flex-wrap:wrap}.frame{height:calc(100vh - 105px)}
.session-actions{display:flex;gap:7px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap;min-height:43px}
.session-actions .name{margin-right:auto;font-size:12px;color:#aaa}
.session-actions button,.notice button,.dialog .action,.context-card button{border:1px solid #555;border-radius:3px;padding:5px 10px;font-size:12px}
button.main-action{background:#0078d4!important;border-color:#0078d4!important;color:white}
.context-card{font:12px/1.8 'Segoe UI',sans-serif;background:#24282e;border:1px solid #38414d;border-radius:4px;padding:12px 16px;margin-bottom:18px}
.context-card strong{display:block;color:#eee;font-size:13px}.context-card .metadata{color:#999}.context-card .buttons{display:flex;gap:7px;margin-top:8px;flex-wrap:wrap}
.task-editor{display:block;width:100%;min-height:260px;resize:vertical;background:transparent;color:#ccc;border:1px solid #444;padding:12px;font:13px/1.9 Consolas,monospace}
.draft-state{font:11px 'Segoe UI',sans-serif;color:#aaa;margin:8px 0}.notices{position:fixed;bottom:35px;right:16px;width:370px;max-width:calc(100vw - 32px);z-index:11;display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow:auto}
.notice{background:#252526;border:1px solid #444;box-shadow:0 5px 20px #0007;padding:12px 14px;font-size:12px;line-height:1.7}.notice .notice-title{color:#eee;overflow-wrap:anywhere}.notice .notice-sub{color:#999;font-size:11px}.notice .buttons{display:flex;gap:7px;justify-content:flex-end;margin-top:9px}.notice .close{float:right;color:#aaa}
.progress-track{height:2px;background:#444;overflow:hidden;margin-top:10px}.progress-track:after{content:'';display:block;background:#0078d4;height:2px;width:40%;animation:progress 2s infinite ease-in-out}@keyframes progress{from{transform:translateX(-100%)}to{transform:translateX(350%)}}
.overlay{position:fixed;inset:0;background:#0006;z-index:30;display:flex;align-items:flex-start;justify-content:center;padding-top:70px}.dialog{background:#252526;border:1px solid #454545;box-shadow:0 8px 40px #0009;width:650px;max-width:95vw;padding:13px;max-height:80vh;overflow:auto}.dialog .dialog-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:10px}.dialog input{width:100%;background:#313131;color:white;border:1px solid #007fd4;padding:9px;font:13px 'Segoe UI',sans-serif}.dialog .pick{display:block;text-align:left;width:100%;padding:10px}.dialog .pick small{display:block;color:#999;font-size:11px;margin-top:3px}.dialog .pick:hover,.dialog .pick:focus{background:#04395e}.dialog p{color:#aaa;line-height:1.8;font-size:12px}.dialog .footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;flex-wrap:wrap}.dialog pre{font:12px/1.9 Consolas,monospace;white-space:pre-wrap}.dialog .empty{padding:16px;color:#aaa}.guard{color:#e2c263;font-size:11px}.tools button{font-size:15px}.settings-form{max-width:650px;font:13px/1.8 'Segoe UI',sans-serif}.settings-form label{display:block;padding:9px 0;border-bottom:1px solid #333}.settings-form small{display:block;color:#888}.settings-form input[type=number],.settings-form textarea{background:#313131;color:#ccc;border:1px solid #555;padding:7px}.settings-form textarea{display:block;width:100%}.selected-session{box-shadow:inset 2px 0 #0078d4}.dirty{color:#e2c263}
`;
document.head.append(style);
const actions = document.createElement('div');
actions.className = 'session-actions';
$('crumb').before(actions);
const notices = document.createElement('div');
notices.className = 'notices';
notices.setAttribute('aria-live', 'polite');
document.body.append(notices);
document.querySelector('.controls').insertAdjacentHTML('beforeend', `
  <label for="outcome">Kết quả lần chạy</label><select id="outcome">
  <option value="completed">Completed</option><option value="blocked">Câu hỏi mới / Blocked</option>
  <option value="failed">Stage failed</option><option value="quota">Quota · chờ 12 giây</option>
  <option value="once">Dispatch limit · Stopped</option><option value="verify">Verify exhausted · exit 6</option>
  <option value="verify7">Verify failed · exit 7</option><option value="config">Config error</option>
  <option value="submission">Lỗi gửi lệnh · giữ draft</option><option value="save">Lỗi lưu task/reply</option>
  <option value="unconfirmed">Không nhận được watcher ack</option></select>
  <button id="palette" title="Ctrl+Shift+P">⌘ Command Palette</button><button id="resetDemo">Reset demo</button>`);
$('scenario').insertAdjacentHTML('beforeend', `
  <option value="changed">Workflow thay đổi · xem diff</option><option value="foreign">Một session bị khóa</option>
  <option value="readonly">Project chỉ đọc</option><option value="stopTimeout">Stop không được xác nhận</option>`);
document.querySelector('.preview p').textContent = 'Phase 3 · Dữ liệu mẫu, không chạy CLI · Draft lưu trong trình duyệt · Thanh thao tác mô phỏng native actions';
document.querySelector('.tools').insertAdjacentHTML('afterbegin', `
  <button id="runWorkflow" title="Run Workflow">▷</button><button id="prepareTask" title="Compose in Editor">＋</button>
  <button id="doctor" title="Migent Doctor">♧</button>`);

const prefs = {maxDispatches:20, progress:true, blocked:true, failed:true, quota:true, completed:true, env:{}};
const operations = new Map();
const storageKey = document.documentElement.dataset.demoStorageKey || 'migent-phase3-drafts-v2';
let dialog = null, returnFocus = null, nextId = Date.now(), openedExecution = null;
let storageAvailable = true;
let saved;
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); }
catch { saved = {}; storageAvailable = false; }
if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
const drafts = new Map(Object.entries(saved.drafts || {}));
const replies = new Map(Object.entries(saved.replies || {}));
const projectOf = s => s.project || 'migent';
const keyOf = s => `${projectOf(s)}::${s.id}`;
const replyKey = (s, b) => `${keyOf(s)}::${b.executionId}`;
const operationOf = s => operations.get(keyOf(s));
const seedBlocked = sessions.find(s => s.state === 'blocked');
seedBlocked.blockers = [
  {stage:'review', attempt:1, executionId:'review-1', question:'Khi lock thuộc host khác hết heartbeat, nên chờ hay coi là stale? Cần quyết định trước khi tiếp tục.'},
  {stage:'security', attempt:1, executionId:'security-1', question:'Có cho phép sửa session trên shared folder khi không kiểm tra được PID ở host khác không?'}
];
seedBlocked.executions.push(['security',1,'blocked','needs input']);
const seedFailed = sessions.find(s => s.state === 'failed');
seedFailed.failure = {kind:'verify', cause:'Watcher reconciliation timed out after 3 retries.', stage:'verify', attempt:2};
for (const s of Object.values(saved.prepared || {})) {
  if (s && typeof s.id === 'string' && s.id.startsWith('s-demo-') && !sessions.some(x => x.id === s.id)) {
    sessions.unshift({...s, state:'prepared', executions:[]});
  }
}
// Emulate disk snapshots independently of extension-owned drafts, for reload demos.
if (Array.isArray(saved.snapshots)) {
  for (const snapshot of saved.snapshots) {
    if (!snapshot || typeof snapshot.id !== 'string' || !Array.isArray(snapshot.executions)) continue;
    const existing = sessions.find(s => keyOf(s) === keyOf(snapshot));
    if (existing) Object.assign(existing, snapshot); else sessions.unshift(snapshot);
  }
}
current = sessions.find(s => s.id === 's-20261030-auth') || sessions[0];
function persistDrafts() {
  const prepared = Object.fromEntries(sessions.filter(s => s.id.startsWith('s-demo-') && s.state === 'prepared').map(s => [keyOf(s), s]));
  try {
    const pending = Object.fromEntries([...operations].map(([key,op]) => {
      const {timer, ...record} = op; return [key,record];
    }));
    localStorage.setItem(storageKey, JSON.stringify({drafts:Object.fromEntries(drafts), replies:Object.fromEntries(replies), prepared, snapshots:sessions, pending}));
    storageAvailable = true;
  } catch { storageAvailable = false; }
}
function reasonUnavailable(s = null) {
  if (scenario === 'missing') return 'Không tìm thấy CLI tại migent.cli.path = migent. Mở Settings hoặc xem hướng dẫn cài đặt.';
  if (scenario === 'old') return 'CLI thấp hơn phiên bản yêu cầu trong migent.cli.minVersion. Cập nhật CLI rồi Recheck.';
  if (scenario === 'readonly') return 'Project chỉ đọc: workspace policy không cho phép ghi. Monitoring vẫn hoạt động.';
  if (scenario === 'project') return 'Project chưa có .migent. Chọn Initialize project trước.';
  if (s && scenario === 'foreign' && s.id === 's-20261030-auth') return 'Live lock: PID 8420 · host build-agent-02 · heartbeat 4 giây trước. Chỉ session này bị khóa.';
  return '';
}
function guard(s = null) {
  const reason = reasonUnavailable(s);
  if (reason) notify(reason);
  return !reason;
}
function eligible(action, s) {
  if (reasonUnavailable(s)) return false;
  if (operationOf(s) && !(action === 'cancel' && operationOf(s).kind === 'run' && s.state === 'running')) return false;
  if (action === 'cancel') return s.state === 'running';
  if (action === 'start') return s.state === 'prepared';
  if (action === 'reply') return s.state === 'blocked' && !!s.blockers?.length && !s.quota;
  if (['continue','once'].includes(action)) return ['failed','blocked','stopped','cancelled'].includes(s.state) && !s.quota;
  if (action === 'repair') return s.state !== 'running';
  return true;
}
function log(s, text) { (s.commandLines ??= []).push(text); persistDrafts(); }
function labelOf(s) { return `${s.title} · ${projectOf(s)} · ${s.id}`; }
function localTime(time) { return new Date(time).toLocaleString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}); }
function quotaLabel(s) { return s.quota ? `Retry in ${Math.max(0, Math.ceil((s.retryAt - Date.now()) / 1000))}s` : 'Retry'; }

function closeDialog() {
  dialog?.remove(); dialog = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}
function modal(title, html, setup) {
  closeDialog(); returnFocus = document.activeElement;
  dialog = document.createElement('div'); dialog.className = 'overlay';
  const node = dialog;
  node.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dialog-head"><span>${esc(title)}</span><button data-close aria-label="Close">×</button></div>${html}</section>`;
  document.body.append(node);
  node.querySelector('[data-close]').onclick = closeDialog;
  node.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
    if (e.key === 'Tab') {
      const items = [...node.querySelectorAll('button:not(:disabled),input,select,textarea')];
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  setup?.(node);
  if (node.isConnected) (node.querySelector('input') || node.querySelector('button.pick,button.action') || node.querySelector('button'))?.focus();
}
function pick(title, items, callback) {
  modal(title, '<input aria-label="Filter choices" placeholder="Type to filter…"><div class="picks"></div>', node => {
    const input = node.querySelector('input'), container = node.querySelector('.picks');
    function draw() {
      container.innerHTML = '';
      const filtered = items.filter(i => `${i.label} ${i.detail || ''}`.toLowerCase().includes(input.value.toLowerCase()));
      for (const item of filtered) {
        const b = document.createElement('button'); b.className = 'pick';
        b.innerHTML = `<span>${esc(item.label)}</span><small>${esc(item.detail || '')}</small>`;
        b.onclick = () => { closeDialog(); callback(item.value); }; container.append(b);
      }
      if (!filtered.length) container.innerHTML = '<div class="empty">Không có lựa chọn phù hợp. Escape để quay lại.</div>';
    }
    input.oninput = draw;
    node.addEventListener('keydown', e => {
      const buttons = [...container.querySelectorAll('button')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); const i = buttons.indexOf(document.activeElement);
        const next=i<0?(e.key==='ArrowDown'?0:buttons.length-1):(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
        buttons[next]?.focus();
      }
      if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); buttons[0]?.click(); }
    }); draw();
  });
}
function confirmChoice(title, message, choices, callback) {
  modal(title, `<p>${esc(message)}</p><div class="footer">${choices.map((c,i) => `<button class="action ${i === 0 ? 'main-action' : ''}" data-choice="${i}">${esc(c)}</button>`).join('')}</div>`, node => {
    node.querySelectorAll('[data-choice]').forEach(b => b.onclick = () => { const value = Number(b.dataset.choice); closeDialog(); callback(value); });
  });
}
function inputBox(title, placeholder, callback, initial = '', compose = null) {
  modal(title, `<form><input aria-label="${esc(title)}" placeholder="${esc(placeholder)}" required><div class="footer">${compose ? '<button type="button" class="action" data-compose>Compose in editor ↗</button>' : ''}<button class="action main-action">${compose ? 'Run' : 'Continue'} ↵</button></div></form>`, node => {
    const input = node.querySelector('input'); input.value = initial;
    node.querySelector('form').onsubmit = e => { e.preventDefault(); const value = input.value.trim(); if (value) { closeDialog(); callback(value); } };
    if (compose) node.querySelector('[data-compose]').onclick = () => { const value = input.value; closeDialog(); compose(value); };
  });
}
function selectSession(s, nextDoc = 'timeline') {
  current = s; doc = nextDoc; openedExecution = null;
  if (scenario === 'empty') { scenario = 'active'; $('scenario').value = scenario; }
  render();
}
function button(label, action, disabled = false, primary = false, title = '') {
  return `<button data-control="${action}" ${disabled ? 'disabled' : ''} ${primary ? 'class="main-action"' : ''} title="${esc(title)}">${esc(label)}</button>`;
}
function contextText(s) {
  const op = operationOf(s);
  if (op) return op.phase;
  if (s.reasonType === 'quota') return `${s.quota ? 'Provider quota · chờ đến' : 'Có thể thử lại từ'} ${localTime(s.retryAt)}. Không tự chạy lại.`;
  if (s.failure) return `${s.failure.stage} · attempt ${s.failure.attempt}: ${s.failure.cause}`;
  if (s.blockers?.length && s.state === 'blocked') return s.blockers.map(b => `${b.stage}#${b.attempt}: ${b.question}`).join('\n');
  return {running:'Đang chờ provider. Tiến trình tiếp tục sau khi đóng VS Code.',prepared:'Soạn task.md; Save & Run lưu nội dung trước khi dispatch.',stopped:'Session đã dừng; Continue tiếp tục và reset revision counts.',cancelled:'Đã xác nhận hủy. Continue có thể tiếp tục session.',completed:'Kết quả được xuất trong outputs/.'}[s.state] || 'Xem timeline để biết thêm chi tiết.';
}
function drawActions() {
  actions.dataset.target = keyOf(current);
  if (['empty','project'].includes(scenario)) { actions.innerHTML = '<span class="name">Migent · chọn Run workflow hoặc Initialize project</span>'; return; }
  const s = current, op = operationOf(s), reason = reasonUnavailable(s);
  actions.innerHTML = `<span class="name">${esc(s.title)} <span class="${s.state}">· ${esc(op ? op.phase : s.state)}</span></span>`;
  if (doc === 'reply.md') {
    actions.innerHTML += button(op ? op.phase : 'Save Reply & Continue','send',!eligible('reply',s),true,reason) + button('Close · keep draft','closeDraft') + button('Discard reply…','discard',!!op);
  } else if (op) {
    if (op.kind === 'run' && s.state === 'running') actions.innerHTML += button('Stop','cancel',!!reason,false,reason);
    if (op.timedOut) actions.innerHTML += button('Recheck status','recheck',false,true);
  } else if (s.reasonType === 'quota') {
    actions.innerHTML += `<button data-control="continue" data-quota="${esc(keyOf(s))}" class="main-action" ${s.quota || reason ? 'disabled' : ''} title="${esc(reason || 'Không tự động restart')}">${quotaLabel(s)}</button>`;
  } else if (s.state === 'prepared') actions.innerHTML += button('Save & Run','start',!eligible('start',s),true,reason);
  else if (s.state === 'running') actions.innerHTML += button('Stop','cancel',!eligible('cancel',s),true,reason);
  else if (s.state === 'blocked' && s.blockers?.length) actions.innerHTML += button('Reply…','reply',!eligible('reply',s),true,reason);
  else if (s.state === 'failed') actions.innerHTML += button('Inspect failure','inspect',false,true);
  else if (['stopped','cancelled'].includes(s.state)) actions.innerHTML += button('Continue','continue',!eligible('continue',s),true,reason);
  else if (s.state === 'completed') actions.innerHTML += button('Open result','result',false,true);
  actions.innerHTML += button('Task','task') + button('View log','log') + button('⋯','menu');
  if (reason) actions.innerHTML += `<span class="guard">${esc(reason)}</span>`;
}
function sessionFiles(s, stage, attempt) {
  return ['prompt.md','response.md','verify.md','notes.md'].map(name => `<button class="file" data-file="${name}" data-session="${s.id}" data-stage="${stage}" data-attempt="${attempt}"><span>M↓</span>${name}</button>`).join('');
}
sessionTree = function(s) {
  const op = operationOf(s), expanded = keyOf(current) === keyOf(s);
  return `<details class="session" data-node-key="${esc(keyOf(s))}" ${expanded ? 'open' : ''}><summary class="${expanded ? 'selected-session' : ''}" data-session="${s.id}" title="${esc(labelOf(s) + '\n' + contextText(s) + '\n' + reasonUnavailable(s))}"><span class="state ${s.state}">${symbols[s.state]}</span><span class="label">${esc(s.title)}</span><span class="desc">${esc(op ? op.phase : `${s.workflow} · ${s.stage} · ${s.elapsed}`)}</span></summary>
  ${s.executions.map(([stage,attempt,state,decision],i) => `<details class="execution" data-node-key="${esc(keyOf(s))}::${stage}-${attempt}" ${expanded && i === s.executions.length-1 ? 'open' : ''}><summary><span class="state ${state}">${symbols[state] || '○'}</span><span>${esc(stage)} · attempt ${attempt}</span><span class="desc">codex/gpt-5 · ${esc(decision || state)}</span></summary>${sessionFiles(s,stage,attempt)}</details>`).join('')}
  ${s.state === 'completed' ? `<details class="folder" open><summary>▱ Outputs</summary>${file('summary.md',s.id,'','output')}${file('changes.patch',s.id,'','output')}</details>` : ''}</details>`;
};
renderTree = function() {
  const welcome = ['empty','project'].includes(scenario);
  const needs = welcome ? 0 : sessions.filter(s => ['blocked','failed'].includes(s.state)).length;
  for (const id of ['badge','activityBadge']) { $(id).textContent = needs; $(id).style.display = needs ? '' : 'none'; }
  $('runWorkflow').disabled = !!reasonUnavailable(); $('prepareTask').disabled = !!reasonUnavailable();
  $('runWorkflow').title = reasonUnavailable() || 'Run Workflow'; $('prepareTask').title = reasonUnavailable() || 'Compose in Editor';
  if (welcome) {
    $('tree').innerHTML = `<div class="welcome"><h3>${scenario === 'project' ? 'Initialize your project' : 'No sessions yet'}</h3><p>${scenario === 'project' ? 'Workspace chưa có .migent.' : 'Chạy workflow hoặc soạn task trong editor.'}</p>${button('Initialize project','init',scenario !== 'project')}${button('Run workflow','run',scenario === 'project',true)}</div>`;
    $('status').textContent = ''; return;
  }
  let html = reasonUnavailable() ? `<div class="hint guard">${esc(reasonUnavailable())}<br>${button('Settings','settings')}${button('Recheck','recheck')}</div>` : '';
  const projects=scenario==='multi'?[...new Set(['migent','migent-vscode',...sessions.map(projectOf)])]:[null];
  for(const project of projects) {
    const projectSessions=project?sessions.filter(s=>projectOf(s)===project):sessions;
    if(project)html+=`<details class="project-group" data-node-key="project:${esc(project)}" open><summary class="project">${esc(project.toUpperCase())}</summary>`;
    for (const [title, states] of [['Running',['running']],['Needs attention',['blocked','failed','stopped']],['Recent',['prepared','completed','cancelled']]]) {
      const list = projectSessions.filter(s => states.includes(s.state));
      if (list.length) html += `<details class="group" data-node-key="${esc(project||'all')}:${title}" open><summary>${title}</summary>${list.map(sessionTree).join('')}</details>`;
    }
    if(project&&!projectSessions.length)html+='<div class="hint">No sessions. Project selection appears before Run.</div>';
    if(project)html+='</details>';
  }
  $('tree').innerHTML = html;
  const running = sessions.filter(s => s.state === 'running').length;
  $('status').textContent = `Migent: ${running} running${needs ? ` · ${needs} needs attention` : ''}`;
  $('status').title = sessions.filter(s => ['blocked','failed'].includes(s.state)).map(s => `${labelOf(s)} · ${s.state}`).join('\n');
};
function editorLines(text) {
  return text.split('\n').map(line => `<div class="code-line ${line.startsWith('#') ? 'heading' : ''}">${esc(line) || ' '}</div>`).join('');
}
renderDoc = function() {
  const s = current;
  $('tab').textContent = `${doc === 'timeline' ? s.id + ' · timeline' : doc} ×`;
  $('channel').textContent = `Migent: ${s.title}`;
  $('crumb').textContent = `migent › .migent › sessions › ${s.id} › ${doc}`;
  $('editorStatus').textContent = `UTF-8 · ${doc === 'timeline' ? 'Log' : 'Markdown'}`;
  $('logs').textContent = (s.commandLines || []).join('\n') || s.executions.map(([stage,attempt,state]) => `[event] ${stage}#${attempt} · ${state}`).join('\n');
  $('editor').innerHTML = '';
  if (['task.md','reply.md'].includes(doc) && (s.state === 'prepared' || doc === 'reply.md')) {
    const reply = doc === 'reply.md';
    const blocker = s.blockers?.find(b => b.executionId === s.replyExecutionId);
    if (reply && !blocker) { $('editor').innerHTML += '<p>Execution này không còn blocked. Draft được giữ; chọn Reply để chọn câu hỏi hiện tại.</p>'; drawActions(); return; }
    const id = reply ? replyKey(s,blocker) : keyOf(s), map = reply ? replies : drafts;
    const initial = reply ? '' : s.task || `# ${s.title}\n\n`;
    const text = map.has(id) ? map.get(id) : initial;
    if (reply) $('editor').innerHTML = `<div class="context-card"><strong>${esc(blocker.stage)} · attempt ${blocker.attempt} · ${esc(blocker.executionId)}</strong><p>${esc(blocker.question)}</p><div class="metadata">${esc(labelOf(s))}</div>${button('Open previous response','previousResponse')}</div>`;
    $('editor').insertAdjacentHTML('beforeend','<textarea class="task-editor" spellcheck="false" aria-label="'+(reply?'Reply content':'Task content')+'"></textarea><div class="draft-state"></div>');
    const area = $('editor').querySelector('textarea'), state = $('editor').querySelector('.draft-state');
    area.value = text; area.readOnly = !!operationOf(s);
    const status = () => { state.textContent = storageAvailable ? 'Draft được giữ khi đóng editor / reload. Save & Run hoặc Save Reply & Continue để gửi.' : 'Trình duyệt không cho lưu draft. Giữ editor mở hoặc sao chép nội dung trước khi reload.'; };
    area.oninput = () => { map.set(id,area.value); persistDrafts(); status(); $('tab').textContent = doc + ' ● draft'; };
    status();
  } else if (doc === 'settings') renderSettings();
  else if (doc === 'doctor') {
    $('editor').innerHTML += '<pre>' + esc(JSON.stringify({project:projectOf(s),cli:scenario==='missing'?'missing':scenario==='old'?'incompatible':'compatible',executable:'migent',availability:reasonUnavailable(s)||'writable',operation:operationOf(s)?.phase||'idle'},null,2)) + '</pre>';
  } else if (doc === 'failure') {
    $('editor').innerHTML += editorLines(`# Failure\n\n${s.failure?.cause || 'Cause unavailable; inspect session log.'}\n\n${s.failure?.kind === 'config' ? 'Fix settings, then run Doctor before retrying.' : 'Inspect the execution response/verify, fix the cause, then Continue.'}`);
    $('editor').insertAdjacentHTML('beforeend',`<div class="context-card">${s.failure?.kind==='config' ? button('Open Settings','settings',false,true)+button('Doctor','doctor') : button('Open failure file','failureFile',false,true)+button('Continue after inspection','continue',!eligible('continue',s))}</div>`);
  } else if (doc === 'timeline') {
    $('crumb').textContent = `migent-session:/${s.id}/timeline`;
    $('editor').innerHTML += editorLines(`# ${s.title}\n# State: ${s.state}\n# ${contextText(s)}\n\n${s.executions.map(([stage,attempt,state])=>`${s.lastEvent||'10:19:08'}  ${stage}#${attempt} ${state} · codex/gpt-5`).join('\n')}\n${(s.commandLines||[]).join('\n')}`);
  } else if (doc === 'summary.md') $('editor').innerHTML += editorLines(`# ${s.title}\n\nWorkflow completed.\n\n✓ Relevant checks passed.\nPublished result: outputs/summary.md`);
  else {
    const ex = openedExecution || {stage:s.stage,attempt:s.executions.at(-1)?.[1] || 1};
    const path = doc === 'task.md' ? `sessions/${s.id}/task.md` : doc === 'changes.patch' ? `sessions/${s.id}/outputs/changes.patch` : `sessions/${s.id}/executions/${ex.stage}-${ex.attempt}/${doc === 'verify.md' ? 'turns/1/verify.md' : doc}`;
    $('crumb').textContent = '.migent/' + path;
    const body = doc === 'task.md' ? s.task || s.title : doc === 'verify.md' ? `${s.failure?.cause || 'Verification passed.'}\n\nExecution: ${ex.stage}#${ex.attempt}` : doc === 'response.md' ? (s.blockers?.find(b=>b.stage===ex.stage&&b.attempt===ex.attempt)?.question || 'Provider response for this execution.') : `# ${doc}\n\nSession: ${s.title}\nExecution: ${ex.stage}#${ex.attempt}\n\nFollow the task requirements and project conventions.`;
    $('editor').innerHTML += editorLines(body);
  }
  drawActions();
};
render = function() {
  const scroll = $('tree').parentElement.scrollTop;
  renderTree();
  // Snapshot updates use refreshView below to avoid replacing an active editor.
  $('tree').parentElement.scrollTop = scroll;
  if (['empty','project'].includes(scenario)) {
    $('tab').textContent='Welcome'; $('crumb').textContent=''; $('editor').innerHTML='<div class="empty-editor"><div class="mark">◈</div><p>Run workflow · Compose in editor</p></div>'; $('logs').textContent='';
  } else renderDoc();
  drawActions();
};
function refreshView(s) {
  const focus = document.activeElement, treeFocus = $('tree').contains(focus);
  const expanded = new Map([...$('tree').querySelectorAll('details')].map(n=>[n.dataset.nodeKey || n.querySelector(':scope > summary')?.textContent,n.open]));
  const scroll = $('tree').parentElement.scrollTop;
  renderTree();
  $('tree').querySelectorAll('details').forEach(n=>{const k=n.dataset.nodeKey || n.querySelector(':scope > summary')?.textContent;if(expanded.has(k))n.open=expanded.get(k);});
  $('tree').parentElement.scrollTop=scroll;
  if (current === s && !['task.md','reply.md','settings','project-file'].includes(doc)) renderDoc();
  else drawActions();
  if (treeFocus) $('tree').querySelector(`summary[data-session="${current.id}"]`)?.focus();
}
function notice(s,type,message,buttons=[],progress=false) {
  if (!progress && prefs[type] === false) return;
  const dedup = `${keyOf(s)}::${progress?'progress':type}`;
  [...notices.children].filter(n=>n.dataset.key===dedup).forEach(n=>n.remove());
  const n=document.createElement('div');n.className='notice';n.dataset.key=dedup;n.dataset.session=keyOf(s);n.dataset.progress=String(progress);
  n.innerHTML=`<button class="close" aria-label="Dismiss notification">×</button><div class="notice-title">${esc(message)}</div><div class="notice-sub">${esc(labelOf(s))}${progress?'<br>Tiếp tục chạy sau khi đóng VS Code.':''}</div>${progress?'<div class="progress-track"></div>':''}<div class="buttons"></div>`;
  n.querySelector('.close').onclick=()=>n.remove();
  for(const [label,fn] of buttons){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{fn(s);if(!progress)n.remove();};n.querySelector('.buttons').append(b);}
  notices.append(n);
}
function removeProgress(s){[...notices.children].filter(n=>n.dataset.session===keyOf(s)&&n.dataset.progress==='true').forEach(n=>n.remove());}
function newSession(title,workflow,text='') {
  const s={id:'s-demo-'+(++nextId),project:selectedProject,title,workflow,stage:'plan',elapsed:'0s',state:'prepared',executions:[],task:text||title};
  sessions.unshift(s);drafts.set(keyOf(s),s.task);persistDrafts();return s;
}
function workflows(callback) {
  pick('Migent: Select workflow',[{label:'plan',value:'plan',detail:'Plan → review'},{label:'feature',value:'feature',detail:'Plan → implement → verify'},{label:'bugfix',value:'bugfix',detail:'Investigate → implement → verify'}],callback);
}
function runWorkflow(compose=false) {
  if(!guard())return;
  const go=()=>workflows(workflow=>{
    if(compose)return inputBox('Migent: Task title','Title…',title=>prepareSession(title,workflow,`# ${title}\n\n`));
    inputBox(`Migent: Task · ${workflow}`,'Describe the task…',text=>{if(guard())startRun(newSession(text,workflow,text),'run');},'',text=>{
      prepareSession(text.trim().split('\n')[0].slice(0,80)||'Untitled task',workflow,text);
    });
  });
  if(scenario==='multi')pick('Migent: Project',[{label:'migent',value:'migent'},{label:'migent-vscode',value:'migent-vscode'}],project=>{selectedProject=project;go();});else{selectedProject='migent';go();}
}
let selectedProject='migent';
function prepareSession(title,workflow,text) {
  if(!guard())return;
  const s=newSession(title,workflow,text);s.project=selectedProject;drafts.set(keyOf(s),text);persistDrafts();
  log(s,'[CLI simulation] migent session prepare');selectSession(s,'task.md');
  notify('Prepared · Nội dung đã nhập được giữ. Save & Run để lưu task.md rồi chạy.');
}
function setProgress(s,message,canCancel=false) {
  notice(s,'progress',message,[['View log',target=>selectSession(target)],...(canCancel?[['Stop',cancelSession]]:[])],true);
}
function startRun(s,mode,extra='',submission=null) {
  const action=mode==='run'?'start':mode==='once'?'once':'continue';
  if(!guard(s)||!eligible(action,s))return notify('Session không còn ở trạng thái phù hợp hoặc đang xử lý lệnh.');
  const chosenOutcome=$('outcome').value;
  const outcome=chosenOutcome==='save'&&mode!=='run'&&!submission?'completed':chosenOutcome;
  if(mode==='run') {
    const task=drafts.has(keyOf(s))?drafts.get(keyOf(s)):s.task;
    if(!task?.trim())return notify('Task trống. Nhập nội dung trước khi Save & Run.');
    if(outcome==='save')return notify('Không lưu được task.md. Draft được giữ; CLI chưa chạy.');
    s.task=task;
  }
  if(submission&&outcome==='save')return notify('Không lưu được reply. Giữ nguyên editor và draft.');
  const op={kind:'run',phase:submission?'Sending reply…':'Starting…',mode,outcome,previous:s.state,submission,extra,ackAt:Date.now()+1000,finishAt:Date.now()+6000};
  operations.set(keyOf(s),op); // Acquired before any asynchronous work.
  const command=mode==='run'?`migent session run --session ${s.id} --workflow ${s.workflow}`:`migent session continue ${s.id}`;
  log(s,`[CLI simulation] ${command}${mode==='once'?' --once':''}${extra} --max-dispatches ${prefs.maxDispatches}${prefs.progress?' --progress':''}`);
  log(s,`[environment] ${Object.keys(prefs.env).length} override(s) · values omitted`);
  refreshView(s);if(current===s&&['task.md','reply.md'].includes(doc))renderDoc();setProgress(s,op.phase);
  op.timer=setTimeout(()=>{
    if(outcome==='submission')return submissionFailed(s,op);
    if(outcome==='unconfirmed'){
      op.phase='Status not confirmed';op.timedOut=true;persistDrafts();removeProgress(s);refreshView(s);
      notice(s,'failed','CLI chưa được watcher xác nhận. Không gửi lệnh trùng.',[['Recheck status',recheck],['View log',target=>selectSession(target)]]);return;
    }
    acknowledgeStart(s,op);
  },1000);
}
function submissionFailed(s,op) {
  operations.delete(keyOf(s));removeProgress(s);log(s,'[spawn error] Simulated CLI transport failure · no watcher acknowledgment');
  refreshView(s);if(current===s&&['reply.md','task.md'].includes(doc)){renderDoc();$('editor').querySelector('textarea')?.focus();}
  notice(s,'failed','Không gửi được lệnh. Session chưa đổi trạng thái; draft được giữ.',[['Return to draft',target=>selectSession(target,op.submission?'reply.md':'task.md')],['View log',target=>selectSession(target)]]);
}
function acknowledgeStart(s,op) {
  if(operationOf(s)!==op)return;
  // Only this simulated watcher acknowledgment changes the persisted snapshot.
  s.state='running';s.reasonType=null;s.quota=false;s.failure=null;s.lastEvent=new Date().toLocaleTimeString();op.phase='Running';op.timedOut=false;
  if(op.submission){
    const previous=s.executions.find(e=>e[0]===op.submission.stage&&`${e[0]}-${e[1]}`===op.submission.executionId);
    if(previous){previous[2]='completed';previous[3]='reply accepted';}
    s.blockers=(s.blockers||[]).filter(b=>b.executionId!==op.submission.executionId);
    if(replies.get(op.submission.key)===op.submission.text)replies.delete(op.submission.key);
    log(s,`[watcher] Reply accepted for ${op.submission.executionId} · submitted draft archived`);persistDrafts();
  }
  const stage=op.submission?.stage||s.stage;const attempt=1+Math.max(0,...s.executions.filter(e=>e[0]===stage).map(e=>e[1]));
  s.stage=stage;s.executions.push([stage,attempt,'running','']);op.execution={stage,attempt};
  log(s,'[watcher] Live lock and execution observed · Running');
  refreshView(s);
  if(current===s&&['task.md','reply.md'].includes(doc)){doc='timeline';renderDoc();}
  setProgress(s,'Running workflow…',true);
  op.timer=setTimeout(()=>finishRun(s,op.mode==='once'?'once':op.outcome),Math.max(0,op.finishAt-Date.now()));
  persistDrafts();
}
function finishRun(s,outcome) {
  const op=operationOf(s);if(op?.timer)clearTimeout(op.timer);operations.delete(keyOf(s));removeProgress(s);
  const ex=op?.execution||{stage:s.stage,attempt:s.executions.at(-1)?.[1]||1};
  const failed=['failed','verify','verify7','config'].includes(outcome);
  s.state=outcome==='quota'||outcome==='once'?'stopped':failed?'failed':outcome;
  s.elapsed='6s';s.lastEvent=new Date().toLocaleTimeString();s.quota=outcome==='quota';s.reasonType=s.quota?'quota':null;
  if(outcome==='blocked')s.blockers=[...(s.blockers||[]),{stage:ex.stage,attempt:ex.attempt,executionId:`${ex.stage}-${ex.attempt}`,question:'Cần xác nhận yêu cầu mới: có áp dụng chính sách này cho session trên shared folder không?'}];
  // A reply may leave another stage blocked; don't lose that question.
  if(outcome==='completed'&&s.blockers?.length)s.state='blocked';
  if(failed)s.failure={kind:outcome==='config'?'config':outcome.startsWith('verify')?'verify':'response',stage:ex.stage,attempt:ex.attempt,cause:outcome==='config'?'Provider configuration is missing.':outcome.startsWith('verify')?'Verification failed: watcher reconciliation timed out.':'Provider stage failed: response did not satisfy requirements.'};
  if(s.executions.length){s.executions.at(-1)[2]=outcome==='completed'?'completed':s.state==='stopped'?'completed':s.state;s.executions.at(-1)[3]=outcome;}
  const codes={completed:0,blocked:1,failed:3,quota:8,once:1,verify:6,verify7:7,config:'ConfigError'};
  log(s,`[watcher] State reconciled: ${s.state} · CLI result ${codes[outcome]}`);
  if(outcome==='quota'){s.retryAt=(op?.finishAt||Date.now())+12000;s.reminded=false;}
  persistDrafts();refreshView(s);
  if(op?.silentCompletion)return; // Don't replay historical completion/failure notifications on reload.
  if(s.state==='completed')notice(s,'completed','Workflow completed.',[['Open result',target=>selectSession(target,'summary.md')]]);
  else if(s.state==='blocked')notice(s,'blocked',s.blockers?.[0]?.question||'Session cần phản hồi.',[['Reply',replySession]]);
  else if(outcome==='quota')notice(s,'quota',`Provider quota. Retry at ${localTime(s.retryAt)}. Không tự chạy lại.`,[['View status',target=>selectSession(target)]]);
  else if(failed)notice(s,'failed',`${ex.stage}#${ex.attempt}: ${s.failure.cause}`,[['Inspect failure',target=>selectSession(target,'failure')],['View log',target=>selectSession(target)]]);
  else notice(s,'stopped','Đã chạy một dispatch; session đang dừng.',[['Continue',target=>continueSession(target,false)]]);
}
function cancelSession(s) {
  if(!guard(s)||s.state!=='running')return;
  const existing=operationOf(s);if(existing&&existing.kind!=='run')return;
  if(existing?.timer)clearTimeout(existing.timer);
  const op={kind:'stop',phase:'Sending stop request…',finishAt:Date.now()+2600,stopTimeout:scenario==='stopTimeout'};operations.set(keyOf(s),op);
  log(s,`[CLI simulation] migent session cancel ${s.id}`);refreshView(s);setProgress(s,op.phase);
  op.timer=setTimeout(()=>{
    op.phase='Waiting for session to stop…';persistDrafts();refreshView(s);setProgress(s,op.phase);
    op.timer=setTimeout(()=>{
      if(op.stopTimeout){
        op.phase='Stop not confirmed';op.timedOut=true;persistDrafts();removeProgress(s);refreshView(s);
        notice(s,'failed','Stop chưa được xác nhận. Production timeout: 15 giây; demo rút còn 2 giây.',[['Recheck status',recheck],['View log',target=>selectSession(target)]]);
      }else acknowledgeStop(s);
    },2000);
  },600);
}
function acknowledgeStop(s) {
  const op=operationOf(s);if(op?.timer)clearTimeout(op.timer);operations.delete(keyOf(s));removeProgress(s);
  s.state='cancelled';if(s.executions.length)s.executions.at(-1)[2]='cancelled';log(s,'[watcher] Cancelled persisted · lock released · exit 130');refreshView(s);
  if(!op?.silentCompletion)notice(s,'cancelled','Đã xác nhận dừng · exit 130.',[['Continue',target=>continueSession(target,false)]]);
}
function recheck(s=current) {
  const op=operationOf(s);
  if(op?.timedOut){if(op.kind==='stop')acknowledgeStop(s);else acknowledgeStart(s,op);notify('Demo: nhận được watcher acknowledgment sau Recheck.');return;}
  log(s,'[reconcile] Re-read session, CLI capability and lock');refreshView(s);notify('Đã kiểm tra lại dữ liệu mô phỏng.');
}
function workflowDecision(s,go) {
  if(!s.workflowChanged)return go(false);
  const decide=()=>confirmChoice(`Workflow changed · ${s.title}`,'Continue resets revision counts; Run next stage once does not. Chọn bản workflow dùng cho lần này.',['View changes','Use session version','Use updated workflow','Cancel'],i=>{
    if(i===0)modal(`Workflow diff · ${s.title}`,`<p>${esc(labelOf(s))} · frozen → workspace</p><pre>  stages:\n    - plan\n<span class="failed">-   - implement: old-provider</span>\n<span class="completed">+   - implement: new-provider\n+   - verify: checks</span></pre><div class="footer"><button class="action main-action" data-back>Back to decision</button></div>`,node=>node.querySelector('[data-back]').onclick=()=>{closeDialog();decide();});
    else if(i===1)go(false);else if(i===2)go(true);
  });decide();
}
function continueSession(s,once) {
  if(!guard(s)||!eligible(once?'once':'continue',s))return notify('Session chưa thể tiếp tục. Xem lý do hoặc trạng thái đang xử lý.');
  const dispatch=()=>workflowDecision(s,refresh=>{if(!guard(s))return;startRun(s,once?'once':'continue',refresh?' --refresh-workflow':'');if(operationOf(s)&&refresh)s.workflowChanged=false;});
  if(s.state==='blocked'&&s.blockers?.length)confirmChoice(`Continue without reply · ${s.title}`,'CLI sẽ dispatch lại stage với blocker và response cũ, không có câu trả lời mới.',['Write reply','Continue without reply','Cancel'],i=>{if(i===0)replySession(s);else if(i===1)dispatch();});else dispatch();
}
function replySession(s) {
  if(!guard(s)||!eligible('reply',s))return notify('Session này không có câu hỏi hợp lệ để Reply.');
  const open=b=>{s.replyExecutionId=b.executionId;selectSession(s,'reply.md');};
  if(s.blockers.length>1)pick(`Reply: chọn stage · ${s.title}`,s.blockers.map(b=>({label:`${b.stage} · attempt ${b.attempt}`,detail:b.question,value:b})),open);
  else open(s.blockers[0]);
}
function sendReply(s) {
  const b=s.blockers?.find(x=>x.executionId===s.replyExecutionId);
  if(!b||!guard(s)||!eligible('reply',s))return notify('Execution đã đổi hoặc không còn blocked. Draft vẫn được giữ.');
  const key=replyKey(s,b),text=replies.get(key);
  if(!text?.trim())return notify('Nhập câu trả lời trước khi gửi.');
  workflowDecision(s,refresh=>{
    const extra=` --stage ${b.stage} --reply-file <extension-draft/${b.executionId}.md>${refresh?' --refresh-workflow':''}`;
    startRun(s,'continue',extra,{key,text,executionId:b.executionId,stage:b.stage});
    if(operationOf(s)&&refresh)s.workflowChanged=false;
  });
}
function discardReply(s) {
  const b=s.blockers?.find(x=>x.executionId===s.replyExecutionId);if(!b||operationOf(s))return;
  confirmChoice('Discard reply?',`Xóa bản nháp cho ${s.title} · ${b.stage}#${b.attempt}? Đóng editor sẽ giữ draft.`,['Keep draft','Discard'],i=>{if(i===1){replies.delete(replyKey(s,b));persistDrafts();selectSession(s);}});
}
function repairSession(s) {
  if(!guard(s)||!eligible('repair',s))return notify('Dừng session và đợi xác nhận trước khi Repair.');
  confirmChoice(`Repair · ${s.title}`,`CLI sẽ rebuild status.json từ session directory và cần lấy lock. Không tự chấp nhận thay đổi task hash/provenance. Target: ${labelOf(s)}.`,['Cancel','Repair'],i=>{
    if(i!==1||!guard(s)||!eligible('repair',s))return;
    const op={kind:'repair',phase:'Repairing…'};operations.set(keyOf(s),op);refreshView(s);log(s,`[CLI simulation] migent session repair ${s.id}`);
    op.timer=setTimeout(()=>{operations.delete(keyOf(s));refreshView(s);notify('Repair mô phỏng hoàn tất. Xem Output.');},800);
  });
}
function initialize() {
  if(['missing','old','readonly'].includes(scenario))return guard();
  if(scenario!=='project')return notify('Project đã được khởi tạo. Chọn Run workflow.');
  pick('Initialize project',[{label:'Current workspace: migent',value:'migent',detail:'Folder without .migent'}],()=>pick('Initialize setup',[{label:'Default setup',value:'default'},{label:'Minimal setup',value:'minimal'}],setup=>{scenario='empty';$('scenario').value=scenario;render();$('logs').textContent=`[CLI simulation] migent init · ${setup}\n[exit] 0`;notify('Project initialized. Run workflow để bắt đầu.');}));
}
function failureFile(s) {
  const f=s.failure;if(!f)return selectSession(s,'response.md');current=s;doc=f.kind==='verify'?'verify.md':'response.md';openedExecution={stage:f.stage,attempt:f.attempt};renderDoc();
}
function control(action,s=current) {
  switch(action){
    case 'run':return runWorkflow();case 'prepare':return runWorkflow(true);case 'start':return startRun(s,'run');
    case 'continue':return continueSession(s,false);case 'once':return continueSession(s,true);case 'reply':return replySession(s);
    case 'send':return sendReply(s);case 'discard':return discardReply(s);case 'closeDraft':return selectSession(s);
    case 'cancel':return cancelSession(s);case 'repair':return repairSession(s);case 'init':return initialize();
    case 'doctor':return selectSession(s,'doctor');case 'settings':return selectSession(s,'settings');case 'inspect':return selectSession(s,'failure');
    case 'result':return selectSession(s,'summary.md');case 'task':return selectSession(s,'task.md');case 'log':return selectSession(s);
    case 'failureFile':return failureFile(s);case 'recheck':return recheck(s);
    case 'previousResponse':{const b=s.blockers?.find(b=>b.executionId===s.replyExecutionId);if(b){current=s;doc='response.md';openedExecution={stage:b.stage,attempt:b.attempt};renderDoc();}return;}
    case 'menu':return showMenu(s,actions.getBoundingClientRect().right-240,actions.getBoundingClientRect().bottom);
  }
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-control]');if(!b||b.disabled)return;
  const target=actions.dataset.target;const s=sessions.find(s=>keyOf(s)===target)||current;control(b.dataset.control,s);
});
function showMenu(s,x,y) {
  const items=[];
  if(s.state==='prepared')items.push(['start','Save & Run']);
  if(['blocked','stopped','cancelled','failed'].includes(s.state)&&!s.quota)items.push(['continue',s.state==='blocked'?'Continue without reply…':'Continue · resets revision counts'],['once','Run next stage once · keep revision counts']);
  if(s.blockers?.length&&s.state==='blocked')items.push(['reply','Reply…']);
  if(s.state==='running')items.push(['cancel','Stop']);
  if(s.state!=='running')items.push(['repair','Repair…']);
  items.push(['task','Open task'],['log','View log'],['copy','Copy session ID']);
  $('menu').dataset.target=keyOf(s);
  $('menu').innerHTML=items.map(([a,label])=>`<button data-action="${a}" ${!['task','log','copy'].includes(a)&&!eligible(a,s)?'disabled':''} title="${esc(reasonUnavailable(s))}">${esc(label)}</button>`).join('');
  $('menu').style.display='block';$('menu').style.left=Math.max(0,Math.min(x,innerWidth-310))+'px';$('menu').style.top=Math.max(0,Math.min(y,innerHeight-items.length*32-25))+'px';
}
$('tree').removeEventListener('contextmenu',contextMenu);
$('tree').addEventListener('contextmenu',e=>{const row=e.target.closest('summary[data-session]');if(!row)return;e.preventDefault();const s=sessions.find(s=>s.id===row.dataset.session);showMenu(s,e.clientX,e.clientY);});
$('menu').onclick=e=>{
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
  const s=sessions.find(s=>keyOf(s)===$('menu').dataset.target);$('menu').style.display='none';if(!s)return;
  if(b.dataset.action==='copy'){if(navigator.clipboard)navigator.clipboard.writeText(s.id).then(()=>notify('Copied: '+s.id)).catch(()=>notify(s.id));else notify(s.id);return;}
  control(b.dataset.action,s);
};
$('tree').addEventListener('click',e=>{
  const row=e.target.closest('summary[data-session]');if(row){current=sessions.find(s=>s.id===row.dataset.session);doc='timeline';openedExecution=null;renderDoc();}
  const f=e.target.closest('[data-file]');if(f){current=sessions.find(s=>s.id===f.dataset.session);doc=f.dataset.file;openedExecution={stage:f.dataset.stage,attempt:Number(f.dataset.attempt)||1};renderDoc();}
});
function targetPicker(action) {
  const list=sessions.filter(s=>eligible(action,s));
  if(!list.length)return modal('Migent: No eligible sessions',`<p>Không có session hợp lệ cho ${esc(action)}. Session có thể đang Running, đang gửi lệnh, chờ quota hoặc bị khóa. Kiểm tra Sessions để xem lý do.</p><div class="footer">${button('Refresh','recheck')}${button('Run workflow','run')}</div>`);
  pick(`Migent: Select target · ${action}`,list.map(s=>({label:s.title,detail:`${projectOf(s)} · ${s.id} · ${s.workflow} · ${s.stage} · ${s.state}`,value:s})),s=>control(action,s));
}
function palette() {
  pick('> Migent: Commands',[
    ['run','Run Workflow'],['prepare','Compose in Editor'],['start','Save & Run Prepared Session'],['continue','Continue Session'],
    ['once','Run Next Stage Once'],['reply','Reply to Blocked Session'],['cancel','Stop Session'],['repair','Repair Session'],['doctor','Doctor'],['init','Initialize Project']
  ].map(([value,label])=>({value,label:'Migent: '+label})),action=>['start','continue','once','reply','cancel','repair'].includes(action)?targetPicker(action):control(action));
}
$('palette').onclick=palette;$('runWorkflow').onclick=()=>runWorkflow();$('prepareTask').onclick=()=>runWorkflow(true);$('doctor').onclick=()=>control('doctor');
document.querySelector('.search').onclick=palette;document.querySelector('.search').style.cursor='pointer';
$('settings').onclick=()=>control('settings');$('openSettings').onclick=()=>control('settings');$('timeline').onclick=()=>control('log');$('refresh').onclick=()=>recheck(current);
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();palette();}});
function renderSettings() {
  $('editor').innerHTML=`<div class="settings-form"><h2>Migent Settings</h2><label>Max dispatches <input id="maxDispatches" type="number" min="1" max="1000" value="${prefs.maxDispatches}"><small>Default: 20. Continue resets revision counts; Run next stage once keeps them.</small></label><label><input type="checkbox" id="runProgress" ${prefs.progress?'checked':''}> Pass --progress to CLI</label><h3>Notifications</h3>${['blocked','failed','quota','completed'].map(t=>`<label><input type="checkbox" data-pref="${t}" ${prefs[t]?'checked':''}> ${t}</label>`).join('')}<label>migent.env<textarea id="env" rows="3">${esc(JSON.stringify(prefs.env,null,2))}</textarea><small>JSON object of strings. Values are omitted from logs. Settings here last until reload.</small></label><p>CLI path: migent · Minimum version: configured by extension.<br>Demo does not detect a real CLI version.</p></div>`;
  $('maxDispatches').onchange=e=>{prefs.maxDispatches=Math.max(1,Math.min(1000,Number(e.target.value)||20));e.target.value=prefs.maxDispatches;};
  $('runProgress').onchange=e=>prefs.progress=e.target.checked;
  document.querySelectorAll('[data-pref]').forEach(n=>n.onchange=()=>prefs[n.dataset.pref]=n.checked);
  $('env').onchange=e=>{try{const v=JSON.parse(e.target.value);if(!v||Array.isArray(v)||typeof v!=='object'||Object.values(v).some(x=>typeof x!=='string'))throw Error();prefs.env=v;notify('Updated environment overrides.');}catch{notify('Environment phải là JSON object với các giá trị chuỗi.');}};
}
$('scenario').onchange=e=>{
  scenario=e.target.value;closeDialog();$('menu').style.display='none';openedExecution=null;
  current=sessions.find(s=>s.id===(scenario==='completed'?'s-20261029-paths':scenario==='changed'?'s-20261029-cli':'s-20261030-auth'));
  if(scenario==='changed')current.workflowChanged=true;
  if(scenario==='stopTimeout'&&current.state!=='running'){
    current.state='running';current.executions.push(['implement',1,'running','']);
  }
  doc=scenario==='completed'?'summary.md':'timeline';render();
};
$('simulate').textContent='▷ Phát sự kiện mẫu';$('simulate').title='State transition sau activation';
$('simulate').onclick=()=>pick('Mô phỏng sự kiện CLI bên ngoài',[
  {label:'Blocked · 2 câu hỏi cần Reply',value:'blocked'},{label:'Failed · inspect exact execution',value:'verify'},
  {label:'Quota · countdown 12 giây',value:'quota'},{label:'Completed · open result',value:'completed'}
],outcome=>{
  const s=newSession('Demo '+outcome,'feature');s.stage='review';s.state='running';s.executions=[['review',1,'running','']];
  if(outcome==='blocked')s.blockers=[{stage:'security',attempt:1,executionId:'security-1',question:'Có cho phép truy cập workspace từ host khác không?'}];
  selectSession(s);finishRun(s,outcome);
});
$('resetDemo').onclick=()=>confirmChoice('Reset demo?','Xóa task/reply drafts của bản mô phỏng này và tải lại trang. Không thay đổi file hay CLI.',['Keep drafts','Reset'],i=>{if(i===1){try{localStorage.removeItem(storageKey);}catch{}location.reload();}});
// Reload reattaches to the simulated runner; it does not log/spawn another CLI command.
for (const [key,record] of Object.entries(saved.pending || {})) {
  const s=sessions.find(s=>keyOf(s)===key);if(!s||!record||typeof record!=='object')continue;
  const op={...record,silentCompletion:record.finishAt<=Date.now()};operations.set(key,op);
  if(op.timedOut)continue;
  if(op.kind==='run') {
    const resume=()=>{
      if(s.state==='running') {
        setProgress(s,'Reattached · Running',true);
        op.timer=setTimeout(()=>finishRun(s,op.mode==='once'?'once':op.outcome),Math.max(0,op.finishAt-Date.now()));
      } else if(op.outcome==='submission') submissionFailed(s,op);
      else if(op.outcome==='unconfirmed') {op.timedOut=true;op.phase='Status not confirmed';persistDrafts();refreshView(s);}
      else acknowledgeStart(s,op);
    };
    op.timer=setTimeout(resume,Math.max(0,(s.state==='running'?Date.now():op.ackAt)-Date.now()));
  } else if(op.kind==='stop') {
    op.timer=setTimeout(()=>{
      if(op.stopTimeout){op.timedOut=true;op.phase='Stop not confirmed';persistDrafts();refreshView(s);}
      else acknowledgeStop(s);
    },Math.max(0,op.finishAt-Date.now()));
  } else operations.delete(key); // Short-command result must be rechecked, never re-issued on reload.
}
const fitFrame=()=>document.querySelector('.frame').style.height=Math.max(640,innerHeight-document.querySelector('.preview').getBoundingClientRect().height)+'px';
new ResizeObserver(fitFrame).observe(document.querySelector('.preview'));window.addEventListener('resize',fitFrame);fitFrame();
setInterval(()=>{
  for(const s of sessions){
    if(s.quota&&s.retryAt<=Date.now()){
      s.quota=false;
      if(!s.reminded){s.reminded=true;notice(s,'quota','Đã đến giờ thử lại. Không tự chạy lại.',[['Retry',target=>continueSession(target,false)]]);}
      refreshView(s);
    }
  }
  document.querySelectorAll('[data-quota]').forEach(n=>{const s=sessions.find(s=>keyOf(s)===n.dataset.quota);if(s){n.textContent=quotaLabel(s);n.disabled=!!(s.quota||reasonUnavailable(s)||operationOf(s));}});
},500);
render();
