(() => {
  const data = JSON.parse(document.getElementById('checklist-data').textContent);
  const key = 'do-testing-checklist-v1';
  const uiKey = 'do-testing-runner-v2';
  const $ = id => document.getElementById(id);
  const read = k => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  let state = read(key), ui = read(uiKey), undo = null;
  const esc = v => String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain = v => String(v || '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const rich = v => esc(v).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => /^(https?:\/\/|\/(?!\/))/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${label} ↗</a>` : label);
  const paths = {check:'m5 12 4 4L19 6',arrow:'M5 12h14m-6-6 6 6-6 6',mic:'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0m-6 6v3m-3 0h6',desktop:'M3 4h18v13H3zM8 21h8m-4-4v4',sync:'M3 8h15l-4-4m7 12H6l4 4',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z',flag:'M5 21V3h14l-3 4 3 4H5',alert:'M12 8v5m0 4v.1M12 3 2 21h20z',copy:'M9 9h12v12H9zM5 15H3V3h12v2',list:'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1'};
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.list}"/></svg>`;
  const labels = ['Website & iPhone','Mac app','Device Sync','Release checks','Finish up'];
  const hints = ['Start here · record, edit, organize','Shortcuts, insertion & cleanup','Have two devices ready','Errors, recovery & permissions','Clean up your test data'];
  const partIcons = ['mic','desktop','sync','shield','flag'];
  const sections = data.parts.flatMap((p, pi) => p.sections.filter(s => s.items.length).map(s => ({...s, pi, partNote:p.note})));
  const items = sections.flatMap(s => s.items.map((item,i) => ({id:'s'+s.number+'-'+i, sec:s, item, index:i})));
  const status = id => ['done','issue','skip'].includes(state[id]?.status) ? state[id].status : state[id]?.done ? 'done' : 'open';
  const names = {open:'Not tested',done:'Worked',issue:'Problem',skip:'Skipped'};
  let part = Number.isInteger(ui.part) && ui.part >= 0 && ui.part < data.parts.length ? ui.part : 0;
  let current = items.find(x => x.id === ui.current && x.sec.pi === part) || items.find(x => x.sec.pi === part && status(x.id) === 'open') || items.find(x => x.sec.pi === part);
  let mode = 'guided', filter = 'all', query = '', expanded = false;
  function save(){try{localStorage.setItem(key,JSON.stringify(state));localStorage.setItem(uiKey,JSON.stringify({part,current:current.id}));$('saveWarning').hidden=true;}catch{$('saveWarning').hidden=false;}}
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').hidden=true,3000);}
  function counts(list){const c={open:0,done:0,issue:0,skip:0};list.forEach(x=>c[status(x.id)]++);return c;}
  function navigate(x){if(!x)return;current=x;part=x.sec.pi;mode='guided';save();render();$('stepTitle').focus();}
  function setStatus(id,value){undo={id,previous:state[id] ? {...state[id]} : undefined};state[id]={...state[id],status:value,done:value==='done'};save();render();toast(names[value]+' saved. You can undo this result.');if(value==='issue'||value==='skip')$('stepNote')?.focus();}
  function render(){
    const all=counts(items), list=items.filter(x=>x.sec.pi===part), c=counts(list);
    $('partNav').innerHTML=labels.map((label,i)=>{const n=counts(items.filter(x=>x.sec.pi===i));return `<button data-part="${i}" class="${part===i?'active':''}" aria-current="${part===i?'step':'false'}">${icon(partIcons[i])}<span>${label}<small>${n.open} left · ${n.issue} problems</small></span></button>`;}).join('');
    $('overallProgress').max=items.length;$('overallProgress').value=items.length-all.open;
    $('overallText').textContent=`${items.length-all.open} of ${items.length} steps reviewed`;
    $('overallDetail').textContent=`${all.done} worked · ${all.issue} problems · ${all.skip} skipped`;
    $('areaTitle').textContent=labels[part];$('areaHint').textContent=hints[part];
    $('counts').innerHTML=[['open','To test'],['done','Worked'],['issue','Problems'],['skip','Skipped']].map(([s,l])=>`<button class="count ${mode==='browse'&&filter===s?'active':''}" data-filter="${s}" aria-pressed="${mode==='browse'&&filter===s}"><b>${c[s]}</b> ${l}</button>`).join('');
    $('guidedButton').setAttribute('aria-pressed',String(mode==='guided'));$('browseButton').setAttribute('aria-pressed',String(mode==='browse'));
    $('guided').hidden=mode!=='guided';$('browse').hidden=mode!=='browse';$('expandAll').hidden=mode!=='browse';
    renderGuide();renderBrowse();$('undoResult').disabled=!undo;
  }
  function renderGuide(){
    const s=current.sec, n=current.index, local=items.filter(x=>x.sec.number===s.number), area=items.filter(x=>x.sec.pi===part), c=counts(area), st=status(current.id), next=items[items.indexOf(current)+1];
    $('guided').innerHTML=`<div class="runner-layout"><article class="card"><div class="card-head"><div class="eyebrow">${icon(partIcons[part])} Test ${esc(s.number)} · ${local.length} steps</div><h2 id="stepTitle" tabindex="-1">${esc(s.title)}</h2><div class="step-progress" aria-label="Steps in this test">${local.map((x,i)=>`<button class="step-dot ${status(x.id)} ${x.id===current.id?'current':''}" data-jump="${x.id}" aria-label="Step ${i+1}: ${names[status(x.id)]}" ${x.id===current.id?'aria-current="step"':''}>${status(x.id)==='done'?'✓':i+1}</button>`).join('')}</div></div><div class="step-body"><div class="step-heading"><span>STEP ${n+1} OF ${local.length} · DO THIS</span><span class="badge ${st}">${names[st]}</span></div><div class="instruction">${rich(current.item.text)}</div>${current.item.code?`<pre class="sample">${esc(current.item.code)}</pre><button class="btn" id="copySample">${icon('copy')} Copy sample</button>`:''}${s.partNote.length||s.note.length?`<details class="context"><summary>Before you test</summary><p>${[...s.partNote,...s.note].map(rich).join('<br>')}</p></details>`:''}${s.lookFor?`<div class="expected"><strong>${icon('check')} What success looks like</strong>${rich(s.lookFor)}<div class="muted" style="font-size:14px;margin-top:6px">Check this across the ${local.length} steps in this test.</div></div>`:''}<label class="note-label" for="stepNote">${st==='issue'?'What went wrong?':st==='skip'?'Why did you skip this?':'Notes (optional)'}</label><textarea id="stepNote" placeholder="What did you see? Include the device and any error message.">${esc(state[current.id]?.note)}</textarea><div class="actions" aria-label="Record your result"><button class="btn pass" data-result="done" aria-pressed="${st==='done'}">${icon('check')} Worked</button><button class="btn problem" data-result="issue" aria-pressed="${st==='issue'}">${icon('alert')} Problem</button><button class="btn" data-result="skip" aria-pressed="${st==='skip'}">Skip</button></div></div><div class="card-foot"><button class="btn" id="previous" ${items.indexOf(current)===0?'disabled':''}>Back</button><small>Results save as you go</small><button class="btn primary" id="next">${next?(n===local.length-1?'Next test':'Next step'):'View results'} ${icon('arrow')}</button></div></article><aside class="section-list"><h3>IN THIS AREA · ${c.open} STEPS LEFT</h3>${sections.filter(x=>x.pi===part).map(sec=>{const group=items.filter(x=>x.sec===sec), co=counts(group);return `<button data-section="${sec.number}" class="${sec===s?'active':''}" ${sec===s?'aria-current="step"':''}><span>${sec.number}.</span><span>${esc(sec.title)}<small>${co.done} / ${group.length} worked${co.issue?' · '+co.issue+' problems':''}</small></span></button>`;}).join('')}<button class="btn" id="resumeOpen">Go to next untested step ${icon('arrow')}</button></aside></div>`;
    $('stepNote').addEventListener('input',e=>{state[current.id]={...state[current.id],note:e.target.value};save();});
    $('previous').onclick=()=>navigate(items[items.indexOf(current)-1]);
    $('next').onclick=()=>{if(next)navigate(next);else{mode='browse';filter='all';render();toast('Review your results, then copy your report.');}};
    $('resumeOpen').onclick=()=>{const after=area.filter(x=>items.indexOf(x)>items.indexOf(current));const x=after.find(x=>status(x.id)==='open')||area.find(x=>status(x.id)==='open');if(x)navigate(x);else{mode='browse';filter=c.issue?'issue':'all';render();toast('Every step in this area has a result.');}};
    if($('copySample'))$('copySample').onclick=()=>copy(current.item.code);
  }
  function matches(x){return x.sec.pi===part&&(filter==='all'||status(x.id)===filter)&&(!query||plain(x.item.text+' '+x.sec.title+' '+x.sec.lookFor+' '+(state[x.id]?.note||'')).toLowerCase().includes(query));}
  function renderBrowse(){
    $('filter').value=filter;
    const found=items.filter(matches);
    $('browseList').innerHTML=found.length?sections.filter(s=>s.pi===part).map(s=>{const group=found.filter(x=>x.sec===s);if(!group.length)return '';return `<details class="test-group" ${expanded||filter!=='all'||query?'open':''}><summary>${esc(s.number)}. ${esc(s.title)} <span class="badge">${group.length} steps</span></summary>${group.map(x=>`<div class="test-row"><div class="row-top"><p><strong>${x.index+1}.</strong> ${rich(x.item.text)}</p><span class="badge ${status(x.id)}">${names[status(x.id)]}</span></div>${state[x.id]?.note?`<p class="row-note">${esc(state[x.id].note)}</p>`:''}<div class="row-actions"><button class="btn" data-jump="${x.id}">Open guided step ${icon('arrow')}</button><button class="btn" data-reopen="${x.id}">Mark untested</button></div></div>`).join('')}</details>`;}).join(''):`<div class="empty"><h2>${filter==='issue'?'No problems recorded':filter==='open'?'No untested steps here':'No matching steps'}</h2><p>${query?'Try a different search or clear your filters.':'Choose another area or view all steps.'}</p><button class="btn" id="clearFilters">Show all steps</button></div>`;
    if($('clearFilters'))$('clearFilters').onclick=()=>{filter='all';query='';$('search').value='';render();};
  }
  function report(){const c=counts(items);return ['DO testing report',new Date().toLocaleString(),`Worked: ${c.done} / ${items.length} | Not tested: ${c.open} | Problems: ${c.issue} | Skipped: ${c.skip}`,'',...items.filter(x=>['issue','skip'].includes(status(x.id))||state[x.id]?.note).map(x=>`${labels[x.sec.pi]} · Test ${x.sec.number}, step ${x.index+1} [${names[status(x.id)]}]\n${plain(x.item.text)}\n${state[x.id]?.note||'No note added.'}\n`)].join('\n');}
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copied. Paste it into your development task.');}catch{$('reportPanel').hidden=false;$('reportText').value=text;$('reportText').focus();$('reportText').select();toast('Copy the selected text manually.');}}
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.part!==undefined){part=Number(b.dataset.part);current=items.find(x=>x.sec.pi===part&&status(x.id)==='open')||items.find(x=>x.sec.pi===part);save();render();}if(b.dataset.jump)navigate(items.find(x=>x.id===b.dataset.jump));if(b.dataset.section){const group=items.filter(x=>x.sec.number===b.dataset.section);navigate(group.find(x=>status(x.id)==='open')||group[0]);}if(b.dataset.result)setStatus(current.id,b.dataset.result);if(b.dataset.filter){filter=b.dataset.filter;mode='browse';render();}if(b.dataset.reopen)setStatus(b.dataset.reopen,'open');});
  $('guidedButton').onclick=()=>{mode='guided';render();};$('browseButton').onclick=()=>{mode='browse';render();};
  $('filter').onchange=e=>{filter=e.target.value;render();};$('search').oninput=e=>{query=e.target.value.trim().toLowerCase();renderBrowse();};
  $('expandAll').onclick=()=>{expanded=!expanded;$('expandAll').textContent=expanded?'Collapse tests':'Expand tests';renderBrowse();};
  $('undoResult').onclick=()=>{if(!undo)return;const old=undo;if(old.previous)state[old.id]=old.previous;else delete state[old.id];undo=null;save();render();toast('Last result undone.');};
  $('copySummary').onclick=()=>copy(report());
  $('downloadResults').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),state,summary:report()},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='do-testing-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Results exported.');};
  $('printPage').onclick=()=>{$('printContent').innerHTML=sections.map(s=>`<h2>${esc(s.number)}. ${esc(s.title)}</h2>${items.filter(x=>x.sec===s).map(x=>`<p>[${names[status(x.id)]}] ${rich(x.item.text)}${state[x.id]?.note?'<br>'+esc(state[x.id].note):''}</p>`).join('')}`).join('');window.print();};
  window.addEventListener('storage',e=>{if(e.key===key){state=read(key);render();}});
  render();
})();
