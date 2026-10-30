// Shared Project/Workflows surfaces for both HTML previews. Sample files only.
// Native YAML editors in the extension are represented by a highlighted code editor here.
const projectFilesStyle = document.createElement('style');
projectFilesStyle.textContent = `
.sidebar{display:flex;flex-direction:column;min-height:0;overflow:hidden}.sidehead,.sidebar>.section{flex-shrink:0}.sidebar>#tree{flex:1;min-height:90px;overflow:auto;padding-bottom:6px}
.project-file-views{flex-shrink:0;border-top:1px solid var(--line);max-height:45%;overflow:auto}.file-view>summary{height:28px;padding:0 10px;font-size:11px;font-weight:650;letter-spacing:.4px;background:#202020}.file-project>summary{padding:0 12px;font-size:11px;color:#aaa}
.project-file-row{display:flex;align-items:center;min-height:28px;padding:0 12px 0 22px;gap:6px}.project-file-row:hover{background:#2a2d2e}.project-file-row.active-file{background:#04395e}.project-file-row .open-project-file{display:flex;align-items:center;gap:8px;text-align:left;flex:1;min-width:0;padding:4px 0}.open-project-file .filename{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yaml-icon{color:#dcdcaa;font:12px Consolas,monospace}.file-error{color:#f48771}.run-project-workflow{font-size:15px;padding:2px 6px;opacity:0}.project-file-row:hover .run-project-workflow,.run-project-workflow:focus-visible,.project-file-row.active-file .run-project-workflow{opacity:1}.run-project-workflow:disabled{opacity:.3}.view-empty{color:#888;padding:8px 22px;font-size:12px}.missing-file{color:#888;padding:8px 22px;font-size:12px}
.file-document-actions{display:flex;align-items:center;gap:8px;margin-left:auto}.file-document-actions button{padding:5px 10px;border:1px solid #555;border-radius:3px;font-size:12px}.file-document-actions .primary-action{background:#0078d4;border-color:#0078d4;color:white}.file-document-title{font-size:12px;color:#aaa;margin-right:auto}.yaml-editor-shell{display:flex;align-items:flex-start;font:13px/24px Consolas,'Courier New',monospace;overflow:auto;min-height:100%;margin-left:-9px}.yaml-gutter{color:#6e7681;min-width:42px;text-align:right;user-select:none;white-space:pre;margin:0 20px 0 0;flex-shrink:0}.yaml-code{font:inherit;line-height:24px;white-space:pre;tab-size:2;margin:0;min-width:calc(100% - 62px);min-height:280px;outline:none;padding:0 16px 24px 0;color:#ce9178}.yaml-key{color:#9cdcfe}.yaml-comment{color:#6a9955}.yaml-number{color:#b5cea8}.yaml-punctuation{color:#ccc}.yaml-error-bar{font:12px/1.6 'Segoe UI',sans-serif;color:#f48771;border-left:2px solid #f48771;padding:7px 12px;margin-bottom:16px;background:#f4877108}
@media(pointer:coarse){.run-project-workflow{opacity:1}}
`;
document.head.append(projectFilesStyle);
const projectFileViews = document.createElement('div');
projectFileViews.className = 'project-file-views';
document.querySelector('.sidebar').append(projectFileViews);
const isControlPreview = typeof operations !== 'undefined';
const projectConfig = `schema_version: 2
roles:
  planner:
    default_model:
      provider: claude
      model: opus
      options:
        effort: high
    instructions:
      - Read the task and project instructions before planning.
      - Write planning artifacts; do not modify source code.
  reviewer:
    default_model:
      provider: codex
      model: gpt-6.1-sol
    instructions:
      - Review correctness, risks, and verification evidence.
  developer:
    default_model:
      provider: claude
      model: sonnet
    instructions:
      - Implement the requested scope and run relevant checks.
`;
function workflowSource(id, first, role) {
  return `schema_version: 2
id: ${id}
stages:
  - id: ${first}
    role: ${role}
    depends_on: []
    max_revisions: 3
    instructions:
      - ${id === 'plan' ? 'Analyze the task and write an implementation plan.' : 'Implement the requested change and run relevant checks.'}
  - id: review_${first}
    role: reviewer
    depends_on:
      - ${first}
    decision:
      values:
        - approved
        - revise
      routes:
        approved: complete
        revise: ${first}
`;
}
const previewProjectFiles = [
  {key:'migent/config',project:'migent',path:'.migent/config.yaml',name:'config.yaml',kind:'config',content:projectConfig},
  {key:'migent/plan',project:'migent',path:'.migent/workflows/plan.yaml',name:'plan.yaml',kind:'workflow',id:'plan',content:workflowSource('plan','plan','planner')},
  {key:'migent/implement',project:'migent',path:'.migent/workflows/implement.yaml',name:'implement.yaml',kind:'workflow',id:'implement',content:workflowSource('implement','implement','developer')},
  {key:'migent-vscode/config',project:'migent-vscode',path:'.migent/config.yaml',name:'config.yaml',kind:'config',content:projectConfig},
  {key:'migent-vscode/plan',project:'migent-vscode',path:'.migent/workflows/plan.yaml',name:'plan.yaml',kind:'workflow',id:'plan',content:workflowSource('plan','plan','planner')},
  {key:'migent/broken',project:'migent',path:'.migent/workflows/broken.yaml',name:'broken.yaml',kind:'workflow',id:'broken',error:'Line 3: unterminated flow sequence.',content:'schema_version: 2\nid: broken\nstages: [\n'}
];
for (const f of previewProjectFiles) f.savedContent = f.content;
let activeProjectFile = null;
const fileViewExpanded = {workflows:true,project:true};
$('scenario').insertAdjacentHTML('beforeend', '<option value="workflowEmpty">Workflows trống</option><option value="workflowError">Workflow lỗi YAML</option><option value="configMissing">Thiếu config.yaml</option>');
function visibleProjectFiles() {
  if (scenario === 'project') return [];
  return previewProjectFiles.filter(f => {
    if (scenario !== 'multi' && f.project !== 'migent') return false;
    if (scenario === 'workflowEmpty' && f.kind === 'workflow') return false;
    if (scenario === 'configMissing' && f.kind === 'config') return false;
    if (f.key === 'migent/broken' && scenario !== 'workflowError') return false;
    return true;
  });
}
function workflowRestriction(f) {
  if (f.error) return f.error;
  if (isControlPreview) return reasonUnavailable();
  return '';
}
function renderProjectFileViews() {
  const visible = visibleProjectFiles();
  const projects = scenario === 'multi' ? ['migent','migent-vscode'] : ['migent'];
  function rows(kind) {
    return projects.map(project => {
      const files = visible.filter(f => f.project === project && f.kind === kind);
      const list = files.map(f => `<div class="project-file-row ${activeProjectFile === f.key && doc === 'project-file' ? 'active-file' : ''}">
        <button class="open-project-file" data-open-project-file="${esc(f.key)}" title="${esc(project + '/' + f.path + (f.error ? '\n' + f.error : ''))}"><span class="yaml-icon">{ }</span><span class="filename ${f.error ? 'file-error' : ''}">${esc(f.name)}</span>${f.error ? '<span class="file-error">⊗</span>' : ''}</button>
        ${isControlPreview && kind === 'workflow' ? `<button class="run-project-workflow" data-run-project-workflow="${esc(f.key)}" title="${esc(workflowRestriction(f) || 'Run ' + f.id + ' · ' + f.project)}" ${workflowRestriction(f) ? 'disabled' : ''}>▷</button>` : ''}</div>`).join('');
      const empty = kind === 'config' ? '<div class="missing-file" title=".migent/config.yaml">config.yaml · not found</div>' : '<div class="view-empty">No workflows</div>';
      return scenario === 'multi' ? `<details class="file-project" open><summary>${esc(project)}</summary>${list || empty}</details>` : list || empty;
    }).join('');
  }
  projectFileViews.innerHTML = `<details class="file-view" data-file-view="workflows" ${fileViewExpanded.workflows ? 'open' : ''}><summary>WORKFLOWS</summary>${rows('workflow')}</details><details class="file-view" data-file-view="project" ${fileViewExpanded.project ? 'open' : ''}><summary>PROJECT</summary>${rows('config')}</details>`;
  projectFileViews.querySelectorAll('[data-file-view]').forEach(n => n.ontoggle = () => fileViewExpanded[n.dataset.fileView] = n.open);
}
function highlightedYaml(text) {
  return text.split('\n').map(line => {
    let safe = esc(line);
    if (/^\s*#/.test(line)) return `<span class="yaml-comment">${safe}</span>`;
    safe = safe.replace(/^(\s*(?:- )?)([A-Za-z_][\w-]*)(:)/, '$1<span class="yaml-key">$2</span><span class="yaml-punctuation">$3</span>');
    return safe.replace(/(:<\/span>\s*)(\d+|true|false)(\s*)$/, '$1<span class="yaml-number">$2</span>$3');
  }).join('\n');
}
function projectFileButtons() {
  const f = previewProjectFiles.find(f => f.key === activeProjectFile);
  if (!f) return '';
  return `<span class="file-document-title">${esc(f.project)} / ${esc(f.path)}</span><div class="file-document-actions">
  ${isControlPreview && f.kind === 'workflow' ? `<button data-run-project-workflow="${esc(f.key)}" class="primary-action" ${workflowRestriction(f) ? 'disabled' : ''} title="${esc(workflowRestriction(f) || 'Save YAML and run this workflow')}">▷ Run workflow</button>` : ''}
  <button data-save-project-file="${esc(f.key)}" ${f.content === f.savedContent ? 'disabled' : ''}>Save</button></div>`;
}
function drawProjectFileActions() {
  if (isControlPreview) actions.innerHTML = projectFileButtons();
  else {
    let bar = document.querySelector('.project-file-actions');
    if (!bar) { bar = document.createElement('div');bar.className='project-file-actions session-actions';bar.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 16px;border-bottom:1px solid #333';$('crumb').before(bar); }
    bar.innerHTML = projectFileButtons();bar.hidden = false;
  }
}
function renderProjectFile() {
  const f = previewProjectFiles.find(f => f.key === activeProjectFile);
  if (!f) return;
  $('tab').innerHTML = `<span class="yaml-icon">{ }</span> ${esc(f.name)} ${f.content !== f.savedContent ? '●' : '×'}`;
  $('crumb').textContent = `${f.project} › ${f.path.replaceAll('/', ' › ')}`;
  $('editorStatus').textContent = 'Ln 1, Col 1   Spaces: 2   UTF-8   YAML';
  $('editor').innerHTML = `${f.error ? `<div class="yaml-error-bar">${esc(f.error)}</div>` : ''}<div class="yaml-editor-shell"><pre class="yaml-gutter" aria-hidden="true"></pre><pre class="yaml-code" contenteditable="plaintext-only" spellcheck="false" role="textbox" aria-multiline="true" aria-label="${esc(f.path)}"></pre></div>`;
  const code = $('editor').querySelector('.yaml-code');
  const gutter = $('editor').querySelector('.yaml-gutter');
  code.innerHTML = highlightedYaml(f.content);
  const updateGutter = () => gutter.textContent = Array.from({length:f.content.split('\n').length},(_,i)=>i+1).join('\n');
  updateGutter();
  code.oninput = () => {
    f.content = code.innerText.replaceAll('\u00a0',' ');
    $('tab').innerHTML = `<span class="yaml-icon">{ }</span> ${esc(f.name)} ${f.content !== f.savedContent ? '●' : '×'}`;
    drawProjectFileActions();updateGutter();
  };
  code.onkeydown = e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const selection = window.getSelection();if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);range.deleteContents();const space = document.createTextNode('  ');range.insertNode(space);range.setStartAfter(space);range.collapse(true);selection.removeAllRanges();selection.addRange(range);code.dispatchEvent(new Event('input'));
  };
  drawProjectFileActions();renderProjectFileViews();
}
function openProjectFile(key) {
  const f = visibleProjectFiles().find(f => f.key === key);
  if (!f) return notify('File no longer exists in this project.');
  activeProjectFile = key;doc = 'project-file';renderProjectFile();
}
function saveProjectFile(f) {
  if (isControlPreview && $('outcome').value === 'save') { notify('Không lưu được YAML. Nội dung đang sửa được giữ.');return false; }
  f.savedContent = f.content;
  // Fixture validation only; the real extension uses the YAML parser/CLI contract.
  if (f.key === 'migent/broken') f.error = f.content.includes('stages: [') && !f.content.includes(']') ? 'Line 3: unterminated flow sequence.' : null;
  if (f.kind === 'workflow') {
    const match = f.content.match(/^id:\s*([\w-]+)\s*$/m);
    f.id = match?.[1] || f.name.replace(/\.yaml$/, '');
  }
  if (doc === 'project-file' && activeProjectFile === f.key) renderProjectFile();
  else renderProjectFileViews();
  return true;
}
function runProjectWorkflow(key) {
  if (!isControlPreview) return;
  const f = visibleProjectFiles().find(f => f.key === key && f.kind === 'workflow');
  if (!f || workflowRestriction(f)) return notify(f ? workflowRestriction(f) : 'Workflow no longer exists.');
  if (f.content !== f.savedContent && !saveProjectFile(f)) return;
  if (f.error) return notify(f.error);
  const project = f.project;
  const check = () => {
    if (!visibleProjectFiles().includes(f) || workflowRestriction(f)) { notify('Workflow chưa thể chạy. Kiểm tra file và project.');return false; }
    if (f.content !== f.savedContent && !saveProjectFile(f)) return false;
    selectedProject = project;return true;
  };
  inputBox(`Migent: Task · ${project} / ${f.id}`, 'Describe the task…', text => {
    if (check()) startRun(newSession(text,f.id,text),'run');
  }, '', text => {
    if (check()) prepareSession(text.trim().split('\n')[0].slice(0,80)||'Untitled task',f.id,text);
  });
}
const originalFileTree = renderTree;
renderTree = function() { originalFileTree();renderProjectFileViews(); };
const originalFileDocument = renderDoc;
renderDoc = function() {
  if (doc === 'project-file') return renderProjectFile();
  const bar = document.querySelector('.project-file-actions');if (bar) bar.hidden = true;
  originalFileDocument();renderProjectFileViews();
};
if (isControlPreview) {
  const originalDrawActions = drawActions;
  drawActions = function() { if (doc === 'project-file') drawProjectFileActions();else originalDrawActions(); };
  workflows = function(callback) {
    const files = visibleProjectFiles().filter(f => f.kind === 'workflow' && f.project === selectedProject && !f.error);
    if (!files.length) return notify('No runnable workflows in '+selectedProject+'.');
    pick('Migent: Select workflow',files.map(f => ({label:f.id,detail:`${f.project} · ${f.path}`,value:f.id})),callback);
  };
}
document.addEventListener('click', e => {
  const open = e.target.closest('[data-open-project-file]');
  const run = e.target.closest('[data-run-project-workflow]');
  const save = e.target.closest('[data-save-project-file]');
  if (open) openProjectFile(open.dataset.openProjectFile);
  if (run && !run.disabled) runProjectWorkflow(run.dataset.runProjectWorkflow);
  if (save && !save.disabled) { const f=previewProjectFiles.find(f=>f.key===save.dataset.saveProjectFile);if(f)saveProjectFile(f); }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && doc === 'project-file') {
    e.preventDefault();const f=previewProjectFiles.find(f=>f.key===activeProjectFile);if(f)saveProjectFile(f);
  }
});
renderProjectFileViews();
