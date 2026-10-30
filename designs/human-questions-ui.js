// Interaction design only. Questions and answers are fixtures, not a proposed CLI schema.
const humanStyle = document.createElement('style');
humanStyle.textContent = `
.preview{min-height:66px}.preview .controls{gap:10px}.human-design-tag{font-size:11px;color:#959da9}.human-editor{padding:0!important;display:flex;flex-direction:column;overflow:hidden!important;font-family:'Segoe UI',sans-serif!important;line-height:1.5!important}.human-scroll{overflow:auto;flex:1;scroll-behavior:smooth;padding:26px 32px 30px}.human-content{max-width:780px;margin:0 auto}.human-heading{display:flex;align-items:flex-start;gap:15px;margin-bottom:18px}.human-heading h1{font-size:21px;font-weight:600;color:#eee;margin:0 0 7px}.human-heading p{margin:0;color:#9da5ae;font-size:12px}.human-status{font-size:11px;color:#e6c46a;background:#e6c46a10;border:1px solid #e6c46a30;padding:3px 9px;border-radius:12px;white-space:nowrap;margin-left:auto}.human-jumps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}.human-jump{display:flex;align-items:center;gap:7px;border:1px solid #414141;border-radius:4px;padding:6px 10px;font-size:12px;color:#aaa}.human-jump .jump-number{border:1px solid #555;width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-size:10px}.human-jump.answered{color:#b4d9b2}.human-jump.answered .jump-number{background:#89d18520;border-color:#659960;color:#b4d9b2}.human-question{border:1px solid #373b40;background:#222326;border-radius:6px;padding:18px 20px;margin-bottom:15px;scroll-margin-top:18px}.human-question:focus-within{border-color:#526276}.human-question-header{display:flex;align-items:center;gap:9px;margin-bottom:5px}.human-question-number{font-size:11px;color:#929ba5}.human-type{font-size:10px;color:#939da8;margin-left:auto}.human-question h2{font-size:14px;font-weight:600;color:#e4e7eb;line-height:1.6;margin:0 0 12px}.human-option{display:flex;align-items:flex-start;gap:10px;border:1px solid #41454b;border-radius:4px;padding:10px 12px;margin-top:7px;cursor:pointer;line-height:1.5;color:#c7cbd1}.human-option:hover{background:#ffffff04;border-color:#616b79}.human-option:has(input:checked){background:#0078d414;border-color:#3986b7;color:#eee}.human-option input{accent-color:#2997df;margin:3px 0 0;flex-shrink:0}.human-option .option-copy{flex:1}.human-option small{display:block;color:#929ca8;font-size:11px;margin-top:2px}.human-other-field{margin:9px 0 0 25px}.human-other-field[hidden]{display:none}.human-answer-text{width:100%;background:#181b1f;color:#dce1e7;border:1px solid #485361;border-radius:4px;resize:vertical;padding:10px 12px;font:13px/1.7 'Segoe UI',sans-serif;min-height:78px}.human-answer-text:focus{outline:1px solid #3794ce;border-color:#3794ce}.human-answer-text::placeholder{color:#6e7884}.human-footer{border-top:1px solid #3c4148;background:#202328;padding:14px 28px;flex-shrink:0}.human-footer-inner{max-width:780px;margin:auto;display:flex;align-items:center;gap:10px}.human-footer .progress-copy{margin-right:auto;font-size:12px;color:#a2acb8}.human-footer .progress-copy strong{color:#e0e6ed;font-weight:500}.human-footer button,.human-banner button,.human-success button{padding:7px 13px;border:1px solid #596574;border-radius:4px;font-size:12px}.human-footer .human-submit{background:#0078d4;border-color:#0078d4;color:#fff;font-weight:500}.human-submit:disabled{background:#303740;border-color:#414b58;color:#818c9a;opacity:1;cursor:default}.human-footer .next-unanswered{font-size:11px;border:0;color:#8ec7ef;padding:4px}.human-banner{border:1px solid #a67e334f;border-radius:4px;background:#a67e3310;color:#dfc38a;padding:11px 14px;margin-bottom:18px;font-size:12px;line-height:1.7}.human-banner[hidden]{display:none}.human-banner.error{border-color:#f4877150;background:#f487710b;color:#f1b0a2}.human-banner .banner-actions{display:flex;gap:8px;margin-top:9px}.human-background{font-size:12px;color:#9ba6b4;margin:0 0 16px}.human-background>summary{padding:2px 0}.human-background p{padding-left:16px;line-height:1.7}.human-success{border:1px solid #89d18545;border-radius:6px;background:#89d18507;padding:25px;margin:15px 0;color:#cddcc9}.human-success h2{font-size:18px;font-weight:500;color:#d7ebd1;margin:0 0 8px}.human-success p{font-size:12px;color:#a6b5a2}.human-answer-summary{font-size:12px;line-height:1.8;color:#bbc4ce}.human-answer-summary h3{font-size:13px;color:#ddd;margin:16px 0 4px}.human-answer-summary ul{padding-left:19px;margin:3px 0 10px}.human-answer-summary p{white-space:pre-wrap}.human-summary-toggle{font-size:12px;color:#a9b8c8;margin-top:20px}.human-summary-toggle summary{padding:5px 0}.human-draft-label{color:#778491;font-size:10px;margin-top:4px}.human-error-hint{font-size:11px;color:#f1b0a2;margin-top:7px}.human-error-hint:empty{display:none}
@media(max-width:1100px){.human-scroll{padding:22px 18px}.human-heading{flex-wrap:wrap}.human-status{margin-left:0}.human-footer{padding:12px 18px}.human-footer-inner{flex-wrap:wrap}.human-footer .progress-copy{min-width:160px}.human-question{padding:15px}}
`;
document.head.append(humanStyle);
document.querySelector('.preview').innerHTML = `<div><strong>Migent / Human input</strong><p>Thiết kế thử · Dữ liệu mẫu, không gọi CLI</p></div><div class="controls"><label for="human-demo-mode">Khi gửi</label><select id="human-demo-mode"><option value="success">Tiếp tục session</option><option value="failure">Gửi thất bại</option><option value="stale">Câu hỏi đã thay đổi</option></select><button id="human-restart">Làm lại</button></div>`;
// Existing controls stay available to the shared monitoring simulation, outside this design's header.
const hiddenControls = document.createElement('div');hiddenControls.hidden = true;
hiddenControls.innerHTML = '<select id="scenario"><option value="active">active</option></select><select id="outcome"><option value="completed">completed</option><option value="submission">submission</option></select><button id="runWorkflow"></button><button id="prepareTask"></button><button id="simulate"></button>';
// runWorkflow/prepareTask live in the sidebar; only recreate header controls removed above.
hiddenControls.querySelector('#runWorkflow').remove();hiddenControls.querySelector('#prepareTask').remove();document.body.append(hiddenControls);
const humanStorageKey = 'migent-human-design-v1';
let humanModel;
try { humanModel=JSON.parse(localStorage.getItem(humanStorageKey)||'null'); } catch {}
if(!humanModel || humanModel.sessionId!=='s-design-human-review')humanModel={sessionId:'s-design-human-review',version:1,answers:{},phase:'editing'};
let humanSession = sessions.find(s=>s.id===humanModel.sessionId);
if(!humanSession){
  humanSession={id:humanModel.sessionId,title:'Decide how to handle foreign-host locks',project:'migent',workflow:'feature',stage:'review',elapsed:'4m 12s',state:'blocked',question:'human',executions:[['plan',1,'completed','approved'],['implement',1,'completed','done'],['review',1,'blocked','human']],blockers:[{stage:'review',attempt:1,executionId:'review-1',question:'Cần xác nhận chính sách lock và phạm vi kiểm tra trước khi tiếp tục.'}]};
  sessions.unshift(humanSession);
}
humanSession.replyExecutionId=`review-${humanModel.version}`;
let humanStorageOK=true;
function saveHumanDraft(){
  try{localStorage.setItem(humanStorageKey,JSON.stringify(humanModel));humanStorageOK=true;}catch{humanStorageOK=false;}
}
function humanQuestions(){return [
  {id:'lock-policy',short:'Chính sách lock',type:'single',title:humanModel.version===1?'Khi lock thuộc host khác không còn heartbeat, nên xử lý thế nào?':'Khi lock thuộc host khác mất heartbeat quá 60 giây, nên xử lý thế nào?',options:[
    {id:'wait',label:'Chờ thêm 30 giây rồi kiểm tra lại',detail:'Chưa đánh dấu stale ngay lần đầu mất heartbeat.'},
    {id:'manual',label:'Dừng và yêu cầu xử lý thủ công'},
    {id:'stale',label:'Đánh dấu stale sau thời gian chờ',detail:'Cho phép lần chạy tiếp theo tiếp quản session.'}
  ]},
  {id:'verification',short:'Phạm vi kiểm tra',type:'multiple',title:'Cần bổ sung những kiểm tra nào trước khi coi thay đổi là hoàn tất?',options:[
    {id:'unit',label:'Unit tests cho lock còn sống, stale và không tồn tại'},
    {id:'windows',label:'Integration test trên Windows'},
    {id:'foreign',label:'Test lock của host khác trên shared folder'}
  ]},
  {id:'message',short:'Thông báo cho user',type:'text',title:'Khi không xác định được chủ lock, extension nên thông báo gì cho user?',placeholder:'Nhập nội dung hoặc mô tả cách thông báo bạn muốn…'}
];}
function answerOf(q){return humanModel.answers[q.id]||{selected:[],other:false,text:''};}
function isHumanAnswered(q){
  const a=answerOf(q);
  if(q.type==='text')return !!a.text.trim();
  if(a.other&&!a.text.trim())return false;
  return a.selected.length>0||(a.other&&!!a.text.trim());
}
function humanAnsweredCount(){return humanQuestions().filter(isHumanAnswered).length;}
function humanBusy(){return !!operationOf(humanSession);}
function humanConfirmed(){return ['running','completed','stopped','cancelled'].includes(humanSession.state)&&!humanSession.blockers?.some(b=>b.executionId===`review-${humanModel.version}`);}
function humanSummary(answers=humanModel.answers, questions=humanQuestions()){
  return questions.map(q=>{
    const a=answers[q.id]||{selected:[],text:'',other:false};
    const selections=q.options?.filter(o=>a.selected.includes(o.id)).map(o=>o.label)||[];
    return `<h3>${esc(q.title)}</h3>${selections.length?'<ul>'+selections.map(s=>`<li>${esc(s)}</li>`).join('')+'</ul>':''}${a.text&&(a.other||q.type==='text')?`<p>${esc(a.text)}</p>`:''}`;
  }).join('');
}
function humanAnswerText(){
  return humanQuestions().map((q,i)=>{
    const a=answerOf(q),selected=q.options?.filter(o=>a.selected.includes(o.id)).map(o=>o.label)||[];
    return `## ${i+1}. ${q.title}\n${selected.map(x=>'- '+x).join('\n')}${a.other||q.type==='text'?'\n'+a.text.trim():''}`;
  }).join('\n\n');
}
function humanQuestionMarkup(q,i){
  const a=answerOf(q),type=q.type==='single'?'Chọn một':q.type==='multiple'?'Chọn nhiều':'Nhập câu trả lời';
  const inputType=q.type==='single'?'radio':'checkbox';
  return `<section class="human-question" id="human-q-${q.id}" data-human-question="${q.id}" aria-labelledby="human-title-${q.id}">
  <div class="human-question-header"><span class="human-question-number">CÂU ${i+1}</span><span class="human-type">${type}</span></div>
  <h2 id="human-title-${q.id}">${esc(q.title)}</h2>
  ${q.options?q.options.map(o=>`<label class="human-option"><input type="${inputType}" name="${q.id}" value="${o.id}" data-question-choice="${q.id}" ${a.selected.includes(o.id)?'checked':''}><span class="option-copy">${esc(o.label)}${o.detail?`<small>${esc(o.detail)}</small>`:''}</span></label>`).join('')+`
  <label class="human-option"><input type="${inputType}" name="${q.id}" value="other" data-question-choice="${q.id}" ${a.other?'checked':''}><span class="option-copy">Khác — nhập câu trả lời</span></label>
  <div class="human-other-field" ${a.other?'':'hidden'}><textarea class="human-answer-text" data-question-text="${q.id}" aria-label="Câu trả lời khác cho câu ${i+1}" placeholder="Nhập câu trả lời của bạn…">${esc(a.text)}</textarea></div>`:
  `<textarea class="human-answer-text" data-question-text="${q.id}" aria-label="Câu trả lời cho câu ${i+1}" placeholder="${esc(q.placeholder)}">${esc(a.text)}</textarea>`}
  <div class="human-error-hint" data-question-error="${q.id}"></div></section>`;
}
function updateHumanProgress(){
  const questions=humanQuestions(),count=humanAnsweredCount(),busy=humanBusy();
  document.querySelectorAll('[data-human-jump]').forEach(b=>{
    const q=questions.find(q=>q.id===b.dataset.humanJump),done=isHumanAnswered(q);b.classList.toggle('answered',done);b.querySelector('.jump-number').textContent=done?'✓':questions.indexOf(q)+1;
  });
  const progress=document.querySelector('#human-progress');if(progress)progress.innerHTML=`<strong>${count}/${questions.length} câu đã trả lời</strong><div class="human-draft-label">${humanStorageOK?'Bản nháp đã lưu':'Chưa lưu được bản nháp trong trình duyệt'}</div>`;
  const submit=document.querySelector('#human-submit');if(submit){submit.disabled=count!==questions.length||busy||humanModel.phase==='stale';submit.textContent=busy?'Đang gửi…':'Gửi & tiếp tục session';}
  const next=document.querySelector('#human-next-unanswered');if(next)next.hidden=count===questions.length;
  document.querySelectorAll('[data-question-choice],[data-question-text]').forEach(n=>n.disabled=busy);
}
function showHumanError(message,stale=false){
  const banner=document.querySelector('#human-feedback');if(!banner)return;
  banner.hidden=false;banner.classList.toggle('error',!stale);
  banner.innerHTML=esc(message)+(stale?'<div class="banner-actions"><button id="human-load-new">Tải câu hỏi mới</button></div>':'');
  if(stale)banner.querySelector('button').onclick=loadNewHumanQuestions;
  banner.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function loadNewHumanQuestions(){
  humanModel.previous={answers:JSON.parse(JSON.stringify(humanModel.answers)),questions:humanQuestions()};
  humanModel.version+=1;humanModel.answers={};humanModel.phase='editing';humanSession.state='blocked';
  humanSession.blockers=[{stage:'review',attempt:humanModel.version,executionId:`review-${humanModel.version}`,question:'Cần xác nhận chính sách cập nhật trước khi tiếp tục.'}];
  humanSession.executions.push(['review',humanModel.version,'blocked','human']);humanSession.replyExecutionId=`review-${humanModel.version}`;
  saveHumanDraft();persistDrafts();$('human-demo-mode').value='success';renderHumanQuestions();
}
function renderHumanQuestions(){
  $('editor').classList.add('human-editor');
  $('tab').textContent='◈ Human input · review';$('crumb').textContent=`migent › ${humanSession.title} › review · attempt ${humanModel.version}`;
  document.querySelector('.output-panel').style.display='none';
  const confirmed=humanConfirmed();
  if(confirmed){
    humanModel.phase='submitted';saveHumanDraft();
    $('editor').innerHTML=`<div class="human-scroll"><div class="human-content"><div class="human-success"><h2>✓ Đã gửi ${humanQuestions().length} câu trả lời</h2><p>${humanSession.state==='completed'?'Session đã hoàn tất.':'Stage review đang tiếp tục với câu trả lời của bạn.'}</p><button id="human-open-log">Xem tiến trình session</button></div><details class="human-summary-toggle" open><summary>Câu trả lời đã gửi</summary><div class="human-answer-summary">${humanSummary()}</div></details></div></div>`;
    $('human-open-log').onclick=()=>selectSession(humanSession);drawActions();return;
  }
  const questions=humanQuestions();
  $('editor').innerHTML=`<div class="human-scroll"><div class="human-content">
  <div class="human-heading"><div><h1>Review cần câu trả lời của bạn</h1><p>${esc(humanSession.title)} · stage review</p></div><span class="human-status">Chờ phản hồi</span></div>
  <div class="human-jumps">${questions.map((q,i)=>`<button class="human-jump" data-human-jump="${q.id}"><span class="jump-number">${i+1}</span>${esc(q.short)}</button>`).join('')}</div>
  <details class="human-background"><summary>Xem ngữ cảnh từ stage</summary><p>Phần triển khai đã xử lý lock stale trên cùng host. Review cần quyết định cho lock thuộc host khác trước khi có thể chốt thay đổi.</p></details>
  <div class="human-banner" id="human-feedback" role="status" hidden></div>
  <form id="human-form" novalidate>${questions.map(humanQuestionMarkup).join('')}</form>
  ${humanModel.previous?`<details class="human-summary-toggle"><summary>Bản nháp cho câu hỏi trước</summary><div class="human-answer-summary">${humanSummary(humanModel.previous.answers,humanModel.previous.questions)}</div></details>`:''}
  </div></div><div class="human-footer"><div class="human-footer-inner"><div class="progress-copy" id="human-progress"></div><button class="next-unanswered" id="human-next-unanswered">Đến câu chưa trả lời ↓</button><button id="human-later">Để sau</button><button class="human-submit" id="human-submit">Gửi & tiếp tục session</button></div></div>`;
  document.querySelectorAll('[data-human-jump]').forEach(b=>b.onclick=()=>document.querySelector('#human-q-'+b.dataset.humanJump).scrollIntoView({block:'start',behavior:'smooth'}));
  document.querySelectorAll('[data-question-choice]').forEach(input=>input.onchange=()=>{
    const q=questions.find(q=>q.id===input.dataset.questionChoice),a=answerOf(q);
    if(q.type==='single'){a.selected=input.value==='other'?[]:[input.value];a.other=input.value==='other';}
    else if(input.value==='other')a.other=input.checked;
    else {a.selected=input.checked?[...new Set([...a.selected,input.value])]:a.selected.filter(id=>id!==input.value);}
    humanModel.answers[q.id]=a;if(humanModel.phase!=='stale')humanModel.phase='editing';
    const field=document.querySelector(`#human-q-${q.id} .human-other-field`);field.hidden=!a.other;
    if(a.other&&input.value==='other')field.querySelector('textarea').focus();
    const error=document.querySelector(`[data-question-error="${q.id}"]`);error.textContent=a.other&&!a.text.trim()?'Nhập câu trả lời khác để hoàn tất câu này.':'';
    saveHumanDraft();updateHumanProgress();
  });
  document.querySelectorAll('[data-question-text]').forEach(area=>area.oninput=()=>{
    const q=questions.find(q=>q.id===area.dataset.questionText),a=answerOf(q);a.text=area.value;humanModel.answers[q.id]=a;
    document.querySelector(`[data-question-error="${q.id}"]`).textContent='';saveHumanDraft();updateHumanProgress();
  });
  $('human-next-unanswered').onclick=()=>{const q=questions.find(q=>!isHumanAnswered(q));if(q){const section=document.querySelector('#human-q-'+q.id);section.scrollIntoView({block:'start',behavior:'smooth'});section.querySelector('input:not(:disabled),textarea:not(:disabled)')?.focus({preventScroll:true});}};
  $('human-later').onclick=()=>{saveHumanDraft();selectSession(humanSession);};
  $('human-submit').onclick=submitHumanAnswers;
  $('human-form').onsubmit=e=>{e.preventDefault();submitHumanAnswers();};
  updateHumanProgress();
  if(humanModel.phase==='stale')showHumanError('Câu hỏi đã thay đổi. Câu trả lời của bạn chưa được gửi; bản nháp vẫn được giữ.',true);
  else if(humanModel.phase==='failed')showHumanError('Không gửi được câu trả lời. Nội dung vẫn được giữ; bạn có thể thử lại.');
  drawActions();
}
function submitHumanAnswers(){
  if(humanAnsweredCount()!==humanQuestions().length||humanBusy()||humanModel.phase==='stale')return;
  if($('human-demo-mode').value==='stale'){
    humanModel.phase='stale';saveHumanDraft();showHumanError('Câu hỏi đã thay đổi. Câu trả lời của bạn chưa được gửi; bản nháp vẫn được giữ.',true);updateHumanProgress();return;
  }
  const blocker=humanSession.blockers?.find(b=>b.executionId===`review-${humanModel.version}`);
  if(!blocker){showHumanError('Stage không còn chờ bộ câu hỏi này. Bản nháp của bạn vẫn được giữ.',true);humanModel.phase='stale';updateHumanProgress();return;}
  humanModel.phase='sending';saveHumanDraft();
  const text=humanAnswerText(),key=replyKey(humanSession,blocker);replies.set(key,text);
  $('outcome').value=$('human-demo-mode').value==='failure'?'submission':'completed';
  startRun(humanSession,'continue',' --stage review --reply-file <human-answers.md>',{key,text,executionId:blocker.executionId,stage:'review'});
}
const humanOriginalRenderDoc=renderDoc;
renderDoc=function(){
  if(current===humanSession&&doc==='human-questions')return renderHumanQuestions();
  $('editor').classList.remove('human-editor');humanOriginalRenderDoc();
};
const humanOriginalDrawActions=drawActions;
drawActions=function(){
  if(current===humanSession&&doc==='human-questions'){
    actions.dataset.target=keyOf(humanSession);actions.innerHTML=`<span class="name">${esc(humanSession.title)} · review</span><span class="human-design-tag">${humanBusy()?'Đang gửi phản hồi':humanConfirmed()?'Đã gửi':'Cần trả lời '+humanQuestions().length+' câu hỏi'}</span>`;
  }else humanOriginalDrawActions();
};
const humanOriginalReply=replySession;
replySession=function(s){if(s===humanSession){selectSession(s,'human-questions');return;}humanOriginalReply(s);};
const humanOriginalSubmissionFailed=submissionFailed;
submissionFailed=function(s,op){
  if(s!==humanSession)return humanOriginalSubmissionFailed(s,op);
  operations.delete(keyOf(s));removeProgress(s);humanModel.phase='failed';saveHumanDraft();
  log(s,'[submission failure] Answers not accepted; draft retained.');refreshView(s);
  if(current===s){doc='human-questions';renderHumanQuestions();}
  else notice(s,'failed','Không gửi được câu trả lời. Bản nháp vẫn được giữ.',[['Trả lời',target=>replySession(target)]]);
};
const humanOriginalNotice=notice;
notice=function(s,type,message,buttons=[],progress=false){
  if(s===humanSession&&progress&&current===s&&doc==='human-questions')return;
  return humanOriginalNotice(s,type,message,buttons,progress);
};
const humanOriginalAcknowledgeStart=acknowledgeStart;
acknowledgeStart=function(s,op){
  humanOriginalAcknowledgeStart(s,op);
  if(s===humanSession){humanModel.phase='submitted';saveHumanDraft();if(current===s&&doc==='human-questions')renderHumanQuestions();}
};
$('human-restart').onclick=()=>{
  const op=operationOf(humanSession);if(op?.timer)clearTimeout(op.timer);operations.delete(keyOf(humanSession));removeProgress(humanSession);
  humanModel={sessionId:humanSession.id,version:1,answers:{},phase:'editing'};
  Object.assign(humanSession,{state:'blocked',stage:'review',question:'human',executions:[['plan',1,'completed','approved'],['implement',1,'completed','done'],['review',1,'blocked','human']],blockers:[{stage:'review',attempt:1,executionId:'review-1',question:'Cần xác nhận chính sách lock và phạm vi kiểm tra.'}],commandLines:[],replyExecutionId:'review-1'});
  saveHumanDraft();persistDrafts();$('human-demo-mode').value='success';notices.innerHTML='';selectSession(humanSession,'human-questions');
};
saveHumanDraft();persistDrafts();scenario='active';selectSession(humanSession,'human-questions');
