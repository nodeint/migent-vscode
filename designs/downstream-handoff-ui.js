// Downstream handoff interaction design. All CLI operations/files are simulated.
const downstreamStyle=document.createElement('style');
downstreamStyle.textContent=`
.preview{min-height:66px}.handoff-editor{font-family:'Segoe UI',sans-serif!important;line-height:1.6!important;padding:0!important;display:flex;flex-direction:column;overflow:hidden!important}.handoff-scroll{flex:1;overflow:auto;padding:26px 34px}.handoff-content{max-width:800px;margin:0 auto}.handoff-content h1{font-size:22px;font-weight:600;color:#e4e9f0;margin:0 0 8px}.handoff-content h2{font-size:14px;font-weight:600;color:#dce2ea;margin:28px 0 12px}.handoff-subtitle{font-size:12px;color:#929da9;margin:0 0 24px}.handoff-completed{font-size:12px;display:inline-flex;align-items:center;gap:7px;color:#a8d19e;margin-bottom:14px}.handoff-output{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #333;font-size:12px}.handoff-output button,.handoff-link{color:#8ac5ed;padding:0;font-size:12px}.handoff-output small{color:#8793a0;margin-left:auto}.handoff-next{border:1px solid #3c434c;border-radius:5px;margin:10px 0;overflow:hidden}.handoff-next:hover{border-color:#637383}.handoff-next-main{width:100%;text-align:left;padding:16px 18px;display:flex;gap:14px;align-items:center}.handoff-next .next-icon{font-size:20px;color:#7db5d9}.handoff-next .next-copy{flex:1;min-width:0}.handoff-next strong{display:block;color:#e1e7ee;font-size:14px;font-weight:600}.handoff-next .next-task{font-size:12px;color:#9ca7b4;margin-top:4px}.handoff-next .next-meta{font-size:11px;color:#7f8b98;margin-top:6px}.handoff-next .arrow{font-size:21px;color:#7b8da1}.handoff-badge{font-size:11px;border:1px solid #46515f;color:#a6b7c7;border-radius:10px;padding:2px 8px;white-space:nowrap}.handoff-badge.running{border-color:#42779d;color:#8cc4ed}.handoff-badge.prepared{border-color:#80774a;color:#c4b674}.handoff-source-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#939faa;margin-bottom:24px}.handoff-source-line button{color:#8ec6ed;padding:0}.handoff-source-line .source-done{color:#a5c79b}.handoff-field{display:block;font-size:12px;font-weight:500;color:#d5dce5;margin:24px 0 8px}.handoff-task{width:100%;background:#181c21;border:1px solid #4b5968;border-radius:4px;color:#d5dde7;padding:10px 12px;font:13px/1.6 'Segoe UI',sans-serif}.handoff-task:focus{outline:1px solid #3693ce}.handoff-field-actions{display:flex;justify-content:space-between;margin-top:7px}.handoff-field-actions button{color:#8dbde0;font-size:11px;padding:0}.handoff-field-actions button:disabled{color:#65717f}.handoff-table{width:100%;border-collapse:collapse;font-size:12px;text-align:left;margin-bottom:10px}.handoff-table th{font-size:10px;text-transform:uppercase;letter-spacing:.4px;font-weight:500;color:#85919e;padding:8px 10px;border-bottom:1px solid #414852}.handoff-table td{padding:13px 10px;border-bottom:1px solid #343b43}.handoff-table td:first-child{font-family:Consolas,monospace;color:#c5d3df}.handoff-table button{color:#8ec6ed;font:12px Consolas,monospace;padding:0}.handoff-table .absent{color:#f0a591}.handoff-definition{display:flex;align-items:center;gap:10px;font-size:12px;padding:13px 0;border-bottom:1px solid #333}.handoff-definition .definition-path{margin-left:auto;color:#8bbce0;font:11px Consolas,monospace}.handoff-details{margin-top:22px;color:#9cabb9;font-size:12px}.handoff-details summary{padding:4px 0}.handoff-details p{line-height:1.8;margin:10px 16px}.handoff-footer{padding:14px 30px;border-top:1px solid #3c4550;background:#20242a;flex-shrink:0}.handoff-footer-inner{max-width:800px;margin:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.handoff-footer .footer-status{margin-right:auto;color:#96a4b3;font-size:12px}.handoff-footer button,.handoff-alert button,.handoff-child-buttons button,.handoff-empty button{padding:7px 12px;border:1px solid #586675;border-radius:4px;font-size:12px}.handoff-footer .primary,.handoff-child-buttons .primary{width:auto;margin:0;background:#0078d4;border-color:#0078d4}.handoff-footer .primary:disabled{background:#323b45;border-color:#46515e;color:#8793a0;opacity:1}.handoff-alert{padding:12px 15px;border:1px solid #ad7c494a;background:#ad7c490b;color:#e7c096;font-size:12px;margin:16px 0;border-radius:4px;line-height:1.8}.handoff-alert.error{border-color:#f4877140;background:#f4877109;color:#edb4a7}.handoff-alert .alert-actions{display:flex;gap:9px;margin-top:9px}.handoff-child-panel{border:1px solid #436650;border-radius:5px;padding:18px 20px;background:#4b775309;margin:22px 0}.handoff-child-panel strong{font-size:15px;color:#cee2ca;font-weight:500}.handoff-child-panel p{color:#9eb0a2;font-size:12px;margin:7px 0 15px}.handoff-child-buttons{display:flex;gap:9px;flex-wrap:wrap}.handoff-history-row{display:flex;align-items:center;gap:9px;padding:11px 0;border-bottom:1px solid #333;font-size:12px}.handoff-history-row .history-title{color:#b6cce0;text-align:left}.handoff-history-row .history-id{font:10px Consolas,monospace;color:#7c8a99;margin-left:auto}.handoff-empty{padding:18px 0;color:#909eac;font-size:12px}.handoff-lineage{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:12px;color:#9aa8b7;padding:0 0 18px;border-bottom:1px solid #343d46;margin-bottom:24px}.handoff-lineage button{padding:0;color:#8dc5e9}.handoff-prior-strip{font:11px 'Segoe UI',sans-serif;color:#9eafbe;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #333}.handoff-prior-strip button{color:#89c3ea;font-size:11px;padding:0}.handoff-prior-strip .not-bound{color:#c5b279;margin-left:10px}.downstream-tree-file{width:100%;padding:5px 12px 5px 67px;text-align:left;font-size:12px;display:flex;gap:8px;align-items:center}.downstream-tree-file .tree-target{flex:1}.downstream-tree-file .tree-note{font-size:10px;color:#8593a2}.downstream-tree-file:hover{background:#2b3036}.handoff-raw{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.9 Consolas,monospace;color:#b5c8db}.handoff-artifact{font:13px/1.9 Consolas,monospace;color:#c5cbd2;white-space:pre-wrap}.handoff-target-heading{display:flex;align-items:center;gap:14px}.handoff-target-heading .target-kind{margin-left:auto;color:#8d9ba9;font-size:11px}
@media(max-width:1100px){.handoff-scroll{padding:22px 18px}.handoff-footer{padding:12px 18px}.handoff-table td,.handoff-table th{padding:9px 5px}.handoff-definition{flex-wrap:wrap}.handoff-definition .definition-path{margin-left:0}.handoff-history-row{flex-wrap:wrap}}
`;
downstreamStyle.textContent+=`.handoff-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.handoff-choices .handoff-next{margin:0}.handoff-next.selected{border-color:#378cc3;background:#0078d40b}.handoff-next-main[aria-pressed="true"] .next-icon{color:#75beff}.handoff-next-main{padding:12px 14px}.handoff-content>h2{margin-top:22px}.handoff-field{margin-top:20px}.handoff-definition{padding:9px 0}@media(max-width:1000px){.handoff-choices{grid-template-columns:1fr}}`;
document.head.append(downstreamStyle);
document.querySelector('.preview').innerHTML=`<div><strong>Migent / Results</strong><p>Thiết kế thử · Dữ liệu mẫu, không gọi CLI</p></div><div class="controls"><label for="handoff-mode">Tình huống</label><select id="handoff-mode"><option value="ready">Handoff sẵn sàng</option><option value="missingArtifact">Thiếu artifact khi start</option><option value="missingTarget">Không tìm thấy workflow đích</option><option value="bindFailure">Bind context thất bại</option><option value="missingNext">Không ghi được next.json</option><option value="noSuggestions">Không có downstream</option></select><button id="handoff-reset">Làm lại</button></div>`;
const handoffHidden=document.createElement('div');handoffHidden.hidden=true;handoffHidden.innerHTML='<select id="scenario"><option value="active">active</option></select><select id="outcome"><option value="completed">completed</option></select><button id="simulate"></button>';document.body.append(handoffHidden);
const handoffDraftKey='migent-downstream-design-drafts-v1';
let handoffDrafts={};try{handoffDrafts=JSON.parse(localStorage.getItem(handoffDraftKey)||'{}')||{};}catch{}
const sourceId='s-design-plan-approved';
let handoffSource=sessions.find(s=>s.id===sourceId);
if(!handoffSource){
  handoffSource={id:sourceId,title:'Plan safe recovery for foreign-host locks',project:'migent',workflow:'plan',stage:'review_plan',elapsed:'6m 28s',state:'completed',executions:[['plan',1,'completed','done'],['review_plan',1,'completed','approved']],publishedOutputs:{
    approved_plan:{path:'outputs/plan.md',body:'# Approved implementation plan\n\n1. Track heartbeat age independently from PID checks.\n2. Preserve locks owned by another host.\n3. Offer Recheck and show the known owner.\n4. Cover recovery on Windows and shared folders.\n\n## Acceptance\nNo live foreign-host lock is silently replaced.\n'},
    review_notes:{path:'outputs/review.md',body:'# Plan review\n\nDecision: approved\n\nKeep PID and host details visible when ownership cannot be verified.\nVerify both missing-heartbeat and delayed-heartbeat cases.\n'}
  }};sessions.unshift(handoffSource);
}
// Represents canonical suggestions from the frozen source, not editable next.json instructions.
const frozenSuggestions=[
  {workflow:'implement',task:'Implement the approved recovery plan and run the relevant checks.',artifacts:{plan:'approved_plan',review:'review_notes'}},
  {workflow:'document',task:'Document foreign-host lock recovery and troubleshooting.',artifacts:{plan:'approved_plan'}}
];
const documentationFile={key:'migent/document',project:'migent',path:'.migent/workflows/document.yaml',name:'document.yaml',kind:'workflow',id:'document',content:'schema_version: 4\nid: document\nstages:\n  - id: document\n    role: developer\n    instructions:\n      - Update documentation using the provided plan context.\n',savedContent:''};documentationFile.savedContent=documentationFile.content;previewProjectFiles.push(documentationFile);
let handoffSelected=frozenSuggestions[0].workflow;
let handoffLaunch=null,handoffError='',handoffRecovered=false,handoffArtifact=null;
const handoffMode=()=> $('handoff-mode').value;
const suggestionFor=id=>frozenSuggestions.find(s=>s.workflow===id);
const targetFile=id=>previewProjectFiles.find(f=>f.project===projectOf(handoffSource)&&f.kind==='workflow'&&f.id===id);
const handoffChildren=id=>sessions.filter(s=>s.prior_session_id===sourceId&&(!id||s.workflow===id));
function saveHandoffDrafts(){try{localStorage.setItem(handoffDraftKey,JSON.stringify(handoffDrafts));}catch{}}
function taskFor(id){return Object.hasOwn(handoffDrafts,id)?handoffDrafts[id]:suggestionFor(id).task;}
function childLabel(s){return operationOf(s)?.phase||s.state;}
function sourceLink(){return `<button data-handoff-source>${esc(handoffSource.workflow)} · ${esc(handoffSource.id)}</button>`;}
function currentTargetError(id){return handoffMode()==='missingTarget'&&id==='implement'?'Không tìm thấy workflow implement trong project migent.':!targetFile(id)?'Workflow đích không còn tồn tại.':'';}
function bindingError(id){
  if(handoffSource.state!=='completed')return 'Session nguồn chưa hoàn tất.';
  if(currentTargetError(id))return currentTargetError(id);
  if(Object.values(suggestionFor(id).artifacts).some(output=>!handoffSource.publishedOutputs[output]||typeof handoffSource.publishedOutputs[output].body!=='string'))return 'Không đọc được output nguồn.';
  if(handoffMode()==='missingArtifact')return 'Không đọc được outputs/plan.md.';
  if(handoffMode()==='bindFailure')return 'Không tạo được snapshot trong handoff/.';
  return '';
}
function artifactTable(suggestion,child=null){
  return `<table class="handoff-table"><thead><tr><th>Context</th><th>Output nguồn</th><th>${child?.handoff_bound?'Snapshot':'File nguồn'}</th></tr></thead><tbody>${Object.entries(suggestion.artifacts).map(([name,output])=>{
    const source=handoffSource.publishedOutputs[output],bound=child?.handoff_snapshots?.[name];
    const missing=!bound&&handoffMode()==='missingArtifact'&&output==='approved_plan';
    return `<tr><td>${esc(name)}</td><td>${esc(output)}</td><td>${missing?'<span class="absent">outputs/plan.md · không đọc được</span>':`<button data-handoff-artifact="${esc(output)}" ${bound?`data-snapshot-child="${child.id}" data-snapshot-context="${name}"`:''} title="${esc(bound?'SHA-256: '+bound.sha256:source.path)}">${esc(bound?bound.path:source.path)} ↗</button>`}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function childrenMarkup(id){
  const children=handoffChildren(id);if(!children.length)return '';
  return `<h2>Sessions từ lần handoff này</h2>${children.map(s=>`<div class="handoff-history-row"><span class="handoff-badge ${s.state}">${esc(childLabel(s))}</span><button class="history-title" data-handoff-child="${s.id}">${esc(s.title)}</button><span class="history-id">${esc(s.id)}</span></div>`).join('')}`;
}
function nextRows(){
  return frozenSuggestions.map(s=>{
    const children=handoffChildren(s.workflow),active=children.find(c=>['prepared','running'].includes(c.state)),error=currentTargetError(s.workflow);
    return `<div class="handoff-next"><button class="handoff-next-main" data-handoff-target="${s.workflow}"><span class="next-icon">⑂</span><span class="next-copy"><strong>${esc(s.workflow)}</strong><span class="next-task">${esc(s.task)}</span><span class="next-meta">${error?esc(error):Object.keys(s.artifacts).map(name=>esc(name)).join(' · ')}</span></span>${active?`<span class="handoff-badge ${active.state}">${esc(childLabel(active))}</span>`:''}<span class="arrow">›</span></button></div>`;
  }).join('');
}
function handoffShell(content,footer=''){
  $('editor').classList.add('handoff-editor');document.querySelector('.output-panel').style.display='none';
  $('editor').innerHTML=`<div class="handoff-scroll"><div class="handoff-content">${content}</div></div>${footer?`<div class="handoff-footer"><div class="handoff-footer-inner">${footer}</div></div>`:''}`;
}
function renderHandoffSource(){
  $('tab').textContent='✓ plan · Results';$('crumb').textContent=`migent › sessions › ${sourceId} › Results`;
  let next='';
  if(handoffMode()==='noSuggestions')next='<div class="handoff-empty">Không có workflow kế tiếp.</div>';
  else if(handoffMode()==='missingNext'&&!handoffRecovered)next='<div class="handoff-alert">Không ghi được next.json.<div class="alert-actions"><button data-recover-next>Tải lại</button><button data-handoff-log>Xem log</button></div></div>';
  else next=nextRows();
  handoffShell(`<span class="handoff-completed">✓ Completed</span><h1>${esc(handoffSource.title)}</h1><p class="handoff-subtitle">plan · ${esc(sourceId)} · 6m 28s</p><h2>Outputs</h2>${Object.entries(handoffSource.publishedOutputs).map(([id,o])=>`<div class="handoff-output"><span class="yaml-icon">M↓</span><button data-handoff-artifact="${id}">${esc(id)}</button><small>${esc(o.path)}</small></div>`).join('')}<h2>Bước tiếp theo</h2>${next}${childrenMarkup()}<div class="handoff-field-actions"><button data-open-next>next.json ↗</button></div>`);
  drawActions();
}
function renderHandoffDetail(){
  const selection=handoffSelectionMarkup();
  $('tab').textContent=`⑂ ${handoffSelected} · Next step`;
  $('crumb').textContent=`migent › ${sourceId} › Next step › ${handoffSelected}`;
  handoffShell(`<div class="handoff-source-line">Từ ${sourceLink()} <span class="source-done">✓ Completed</span></div><h1>${esc(handoffSelected)}</h1>${selection.html}${childrenMarkup(handoffSelected)}`,`<button data-handoff-source>Quay lại kết quả</button>${selection.footer}`);
  $('handoff-task').oninput=e=>{
    const id=handoffSelected;handoffDrafts[id]=e.target.value;saveHandoffDrafts();
    const run=document.querySelector('[data-run-handoff]');if(run)run.disabled=!e.target.value.trim()||!!handoffLaunch||!!currentTargetError(id);
    const reset=document.querySelector('[data-reset-handoff-task]');if(reset)reset.disabled=e.target.value===suggestionFor(id).task||!!handoffLaunch||e.target.readOnly;
  };
  drawActions();
}
function handoffSelectionMarkup(){
  const s=suggestionFor(handoffSelected),file=targetFile(s.workflow),error=currentTargetError(s.workflow);
  const active=handoffChildren(s.workflow).find(c=>['prepared','running'].includes(c.state));
  const busy=!!handoffLaunch;
  const footer=active?`<span class="footer-status">${esc(childLabel(active))}</span><button class="primary" data-handoff-child="${active.id}">${active.state==='prepared'?'Mở task.md':'Mở session'}</button>`:
    `<span class="footer-status">${busy?'Đang kiểm tra…':''}</span><button data-prepare-handoff ${busy||error?'disabled':''}>Prepare</button><button class="primary" data-run-handoff ${busy||error||!taskFor(s.workflow).trim()?'disabled':''}>${busy?'Đang bắt đầu…':'▷ Run '+esc(s.workflow)}</button>`;
  const html=`
  ${error?`<div class="handoff-alert error">${esc(error)}<div class="alert-actions"><button data-recheck-target>Kiểm tra lại</button></div></div>`:''}${handoffError?`<div class="handoff-alert error" role="alert">${esc(handoffError)}<div class="alert-actions"><button data-recheck-target>Kiểm tra lại</button></div></div>`:''}
  <label class="handoff-field" for="handoff-task">Task</label><input id="handoff-task" class="handoff-task" value="${esc(taskFor(s.workflow))}" ${busy||active?'readonly':''}>
  <div class="handoff-field-actions"><button data-reset-handoff-task ${taskFor(s.workflow)===s.task||busy||active?'disabled':''}>Khôi phục task gợi ý</button></div>
  <h2>Context chuyển sang</h2>${artifactTable(s)}
  <h2>Workflow đích</h2><div class="handoff-definition"><span>${esc(s.workflow)}</span><button class="definition-path" data-view-target="${esc(s.workflow)}" ${!file||error?'disabled':''}>${esc(file?.path||'.migent/workflows/'+s.workflow+'.yaml')} ↗</button></div>
  `;
  return {html,footer};
}
function renderHandoffChild(child){
  const s=suggestionFor(child.workflow),op=operationOf(child);
  $('tab').textContent=`${child.workflow} · ${child.state}`;$('crumb').textContent=`migent › sessions › ${child.id}`;
  handoffShell(`<div class="handoff-lineage">${sourceLink()} <span>→</span><strong>${esc(child.workflow)}</strong><span class="handoff-badge ${child.state}">${esc(childLabel(child))}</span></div><h1>${esc(child.title)}</h1><p class="handoff-subtitle">${esc(child.id)}</p>
  ${child.handoff_error?`<div class="handoff-alert error" role="alert">${esc(child.handoff_error)}</div>`:''}
  <div class="handoff-child-buttons"><button data-open-child-task="${child.id}">${child.state==='prepared'?'Mở task.md':'Xem task.md'}</button><button data-child-log="${child.id}">Xem timeline</button></div>
  <h2>${child.handoff_bound?'Snapshots':'Context'}</h2>${artifactTable(s,child)}${child.handoff_bound?`<details class="handoff-details"><summary>Provenance</summary>${Object.entries(child.handoff_snapshots).map(([name,a])=>`<p>${esc(name)} ← ${esc(a.output)}<br><code>SHA-256 ${esc(a.sha256)}</code></p>`).join('')}</details>`:''}`, `<span class="footer-status">${esc(childLabel(child))}</span><button data-handoff-source>Session nguồn</button>`);
  drawActions();
}
function openHandoffSource(){current=handoffSource;doc='handoff-source';render();}
function openHandoff(id){handoffSelected=id;handoffError='';current=handoffSource;doc='handoff-detail';render();}
function openHandoffChild(id,task=false){
  const child=sessions.find(s=>s.id===id);if(!child)return;
  selectSession(child,task||child.state==='prepared'?'task.md':'handoff-child');
}
async function makeSnapshots(suggestion){
  const snapshots={};
  for(const [name,output]of Object.entries(suggestion.artifacts)){
    const source=handoffSource.publishedOutputs[output],body=source.body,sourcePath=source.path;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
    snapshots[name]={output,sourcePath,path:`handoff/${name}.md`,body,sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')};
  }
  return snapshots;
}
function createHandoffChild(suggestion,task){
  selectedProject=projectOf(handoffSource);const child=newSession(task.split('\n')[0].slice(0,80),suggestion.workflow,task);
  child.stage=suggestion.workflow==='implement'?'implement':'document';child.prior_session_id=sourceId;child.handoff_bound=false;child.handoff_snapshots=null;child.handoff_origin='prepare';persistDrafts();return child;
}
function prepareHandoff(){
  if(handoffLaunch||currentTargetError(handoffSelected)||handoffChildren(handoffSelected).some(c=>['prepared','running'].includes(c.state)))return;
  const s=suggestionFor(handoffSelected),task=taskFor(s.workflow);
  if(!task.trim()){notify('Nhập task trước khi Prepare.');return;}
  const child=createHandoffChild(s,task);
  log(child,`[CLI simulation] migent session prepare ${JSON.stringify(child.title)} --workflow ${s.workflow} --prior ${sourceId}`);
  log(child,'[prepared] Prior recorded. No context snapshots or frozen target definition yet.');
  openHandoffChild(child.id,true);
}
async function runHandoff(){
  const id=handoffSelected,s=suggestionFor(id),task=taskFor(id);
  if(handoffLaunch||!task.trim()||currentTargetError(id)||handoffChildren(id).some(c=>['prepared','running'].includes(c.state)))return;
  handoffLaunch={workflow:id};handoffError='';renderHandoffDetail();
  await new Promise(resolve=>setTimeout(resolve,750));
  const failure=bindingError(id);
  if(failure){handoffLaunch=null;handoffError=failure;if(doc==='handoff-detail')renderHandoffDetail();return;}
  const snapshots=await makeSnapshots(s);
  // Revalidate after asynchronous snapshot preparation; don't redirect to a later selection.
  const changed=bindingError(id);if(changed){handoffLaunch=null;handoffError=changed;if(doc==='handoff-detail')renderHandoffDetail();return;}
  const child=createHandoffChild(s,task);child.handoff_origin='run';handoffLaunch=null;
  startBoundChild(child,snapshots,false);
}
function startBoundChild(child,snapshots,prepared){
  child.handoff_snapshots=snapshots;child.handoff_bound=true;child.handoff_error=null;
  const target=targetFile(child.workflow);child.handoff_target_definition=target?.savedContent||'';
  const op={kind:'run',phase:'Starting…',mode:'run',outcome:'completed',previous:'prepared',ackAt:Date.now()+600,finishAt:Date.now()+6000};
  operations.set(keyOf(child),op);
  const command=prepared?`migent session run --session ${child.id} --workflow ${child.workflow}`:`migent session run --workflow ${child.workflow} --prior ${sourceId} --task ${JSON.stringify(child.task)}`;
  log(child,'[CLI simulation] '+command);log(child,'[bind] Source validated; context snapshots and SHA-256 provenance recorded.');
  selectSession(child,'handoff-child');
  op.timer=setTimeout(()=>acknowledgeStart(child,op),600);persistDrafts();
}
const handoffOriginalStartRun=startRun;
startRun=function(child,mode,extra='',submission=null){
  if(child.prior_session_id!==sourceId||mode!=='run'||child.handoff_bound)return handoffOriginalStartRun(child,mode,extra,submission);
  if(!eligible('start',child)||!guard(child))return;
  const task=drafts.get(keyOf(child))??child.task;if(!task.trim())return notify('Task trống.');
  child.task=task;child.handoff_error=null;const op={kind:'bind',phase:'Binding context…'};operations.set(keyOf(child),op);
  log(child,'[save] task.md saved before binding prior context.');refreshView(child);
  op.timer=setTimeout(async()=>{
    const s=suggestionFor(child.workflow),failure=bindingError(child.workflow);
    if(failure){operations.delete(keyOf(child));child.handoff_error=failure;log(child,'[bind error] '+failure+' · session remains prepared');refreshView(child);if(current===child)renderDoc();return;}
    const snapshots=await makeSnapshots(s);const changed=bindingError(child.workflow);
    if(changed){operations.delete(keyOf(child));child.handoff_error=changed;persistDrafts();refreshView(child);return;}
    operations.delete(keyOf(child));startBoundChild(child,snapshots,true);
  },750);
};
const handoffOriginalSessionTree=sessionTree;
sessionTree=function(s){
  let html=handoffOriginalSessionTree(s),extra='';
  if(s.id===sourceId){
    const outputsStart=html.indexOf('<details class="folder" open><summary>▱ Outputs</summary>');
    if(outputsStart>=0){
      const outputsEnd=html.indexOf('</details>',outputsStart)+10;
      const outputs=`<details class="folder" open><summary>▱ Outputs</summary>${Object.entries(s.publishedOutputs).map(([output,file])=>`<button class="file output" data-handoff-artifact="${output}" title="${esc(output+' · '+file.path)}"><span>M↓</span>${esc(file.path.split('/').at(-1))}</button>`).join('')}</details>`;
      html=html.slice(0,outputsStart)+outputs+html.slice(outputsEnd);
    }
  }
  if(s.id===sourceId&&handoffMode()!=='noSuggestions'&&(handoffMode()!=='missingNext'||handoffRecovered))extra=`<details class="folder" data-node-key="${sourceId}:next" open><summary>⑂ Next workflows</summary>${frozenSuggestions.map(next=>`<button class="downstream-tree-file" data-handoff-target="${next.workflow}"><span>▷</span><span class="tree-target">${next.workflow}</span><span class="tree-note">${handoffChildren(next.workflow).find(c=>['running','prepared'].includes(c.state))?.state||''}</span></button>`).join('')}</details>`;
  if(s.prior_session_id===sourceId)extra+=`<button class="downstream-tree-file" data-handoff-source title="${sourceId}">↖ <span class="tree-target">Source: plan</span></button>`;
  const end=html.lastIndexOf('</details>');return html.slice(0,end)+extra+html.slice(end);
};
const handoffOriginalRenderDoc=renderDoc;
renderDoc=function(){
  if(current.id===sourceId&&['timeline','summary.md'].includes(doc))doc='handoff-source';
  if(doc==='handoff-source')return renderHandoffSource();
  if(doc==='handoff-detail')return renderHandoffDetail();
  if(doc==='handoff-source-log'){
    doc='timeline';$('editor').classList.remove('handoff-editor');handoffOriginalRenderDoc();doc='handoff-source-log';drawActions();return;
  }
  if(doc==='handoff-child')return renderHandoffChild(current);
  if(doc==='handoff-artifact'){
    $('tab').textContent=handoffArtifact.path.split('/').at(-1);$('crumb').textContent=handoffArtifact.owner+' › '+handoffArtifact.path;
    handoffShell(`<pre class="handoff-artifact">${esc(handoffArtifact.body)}</pre>`, '<span class="footer-status"></span><button data-back-handoff>Quay lại</button>');drawActions();return;
  }
  if(doc==='handoff-next-json'){
    $('tab').textContent='next.json';$('crumb').textContent=`${sourceId} › next.json`;
    const next=frozenSuggestions.map(s=>({workflow:s.workflow,task:s.task,artifacts:Object.fromEntries(Object.entries(s.artifacts).map(([name,output])=>[name,{output,path:handoffSource.publishedOutputs[output].path}])),argv:['migent','session','run','--workflow',s.workflow,'--prior',sourceId]}));
    handoffShell('<pre class="handoff-raw">'+esc(JSON.stringify({schema_version:1,source_session_id:sourceId,next},null,2))+'</pre>','<span class="footer-status"></span><button data-handoff-source>Quay lại</button>');drawActions();return;
  }
  $('editor').classList.remove('handoff-editor');handoffOriginalRenderDoc();
  if(current.prior_session_id===sourceId&&doc==='task.md'){
    $('editor').insertAdjacentHTML('afterbegin',`<div class="handoff-prior-strip">Từ ${sourceLink()}</div>`);
    $('editor').querySelector('.draft-state')?.remove();
    if(current.handoff_error)$('editor').insertAdjacentHTML('afterbegin',`<div class="handoff-alert error" role="alert">${esc(current.handoff_error)}</div>`);
  }
};
// Retain the standard session header actions on Results and Next step pages.
const handoffOriginalControl=control;
control=function(action,s=current){
  if(action==='log'&&s.id===sourceId){current=s;doc='handoff-source-log';render();return;}
  return handoffOriginalControl(action,s);
};
document.addEventListener('click',async e=>{
  const target=e.target.closest('[data-handoff-target]');if(target)return openHandoff(target.dataset.handoffTarget);
  if(e.target.closest('[data-handoff-source]'))return openHandoffSource();
  const child=e.target.closest('[data-handoff-child]');if(child)return openHandoffChild(child.dataset.handoffChild);
  const task=e.target.closest('[data-open-child-task]');if(task)return openHandoffChild(task.dataset.openChildTask,true);
  if(e.target.closest('[data-run-handoff]')&&!e.target.closest('button').disabled)return runHandoff();
  if(e.target.closest('[data-prepare-handoff]')&&!e.target.closest('button').disabled)return prepareHandoff();
  if(e.target.closest('[data-reset-handoff-task]')){delete handoffDrafts[handoffSelected];saveHandoffDrafts();return renderHandoffDetail();}
  const definition=e.target.closest('[data-view-target]');if(definition&&!definition.disabled)return openProjectFile(targetFile(definition.dataset.viewTarget).key);
  const artifact=e.target.closest('[data-handoff-artifact]');if(artifact){
    const bound=artifact.dataset.snapshotChild?sessions.find(s=>s.id===artifact.dataset.snapshotChild):null;
    const snapshot=bound?.handoff_snapshots?.[artifact.dataset.snapshotContext],source=handoffSource.publishedOutputs[artifact.dataset.handoffArtifact];
    handoffArtifact={...(snapshot||source),bound:!!snapshot,owner:bound?.id||sourceId};current=bound||handoffSource;doc='handoff-artifact';return renderDoc();
  }
  if(e.target.closest('[data-back-handoff]'))return current.prior_session_id===sourceId?selectSession(current,'handoff-child'):openHandoff(handoffSelected);
  const childLog=e.target.closest('[data-child-log]');if(childLog)return selectSession(sessions.find(s=>s.id===childLog.dataset.childLog));
  if(e.target.closest('[data-handoff-log]'))return control('log',handoffSource);
  if(e.target.closest('[data-open-next]')){doc='handoff-next-json';return renderDoc();}
  if(e.target.closest('[data-recheck-target]')){handoffError='';return renderHandoffDetail();}
  if(e.target.closest('[data-recover-next]')){
    const button=e.target.closest('button');button.disabled=true;button.textContent='Đang tải…';
    log(handoffSource,`[CLI simulation] migent session continue ${sourceId}`);
    setTimeout(()=>{handoffRecovered=true;log(handoffSource,'[completed inspection] next.json regenerated; no stage dispatched.');openHandoffSource();},600);
  }
});
$('handoff-mode').onchange=()=>{handoffError='';handoffRecovered=false;if(doc==='handoff-detail'&&!['missingNext','noSuggestions'].includes(handoffMode()))renderHandoffDetail();else openHandoffSource();};
$('handoff-reset').onclick=()=>{
  if(handoffLaunch)return;
  for(const child of handoffChildren()){
    const op=operationOf(child);if(op?.timer)clearTimeout(op.timer);operations.delete(keyOf(child));removeProgress(child);drafts.delete(keyOf(child));sessions.splice(sessions.indexOf(child),1);
  }
  handoffDrafts={};handoffError='';handoffRecovered=false;saveHandoffDrafts();handoffSource.state='completed';handoffSource.commandLines=[];persistDrafts();notices.innerHTML='';$('handoff-mode').value='ready';openHandoffSource();
};
scenario='active';persistDrafts();openHandoffSource();
