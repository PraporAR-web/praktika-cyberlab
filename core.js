(function(root){
const clean=s=>String(s||'').replace(/\r/g,'').trim();
function initial(){return{version:2,minutes:15,track:'auto',statuses:{},drafts:{},events:[],active:null};}
function nextLessons(state,lessons){return Object.keys(TRACKS).map(track=>lessons.find(l=>l.track===track&&!state.statuses[l.id])).filter(Boolean);}
function recommend(state,lessons){const eligible=lessons.filter(l=>(state.track==='auto'||l.track===state.track)&&!state.statuses[l.id]);const active=eligible.find(l=>l.id===state.active);if(active)return active;const started=eligible.find(l=>state.drafts[l.id]?.started);if(started)return started;const candidates=nextLessons(state,lessons).filter(l=>state.track==='auto'||l.track===state.track);return candidates.find(l=>l.minutes<=state.minutes)||candidates[0]||null;}
function checkOutput(value,expected){return clean(value).split('\n').map(s=>s.trim()).join('\n')===clean(expected).split('\n').map(s=>s.trim()).join('\n');}
function checkHtml(code,type){if(type&&typeof type==='object')return checkRules(code,type.rules);const doc=new DOMParser().parseFromString(code,'text/html'),txt=e=>e?.textContent.trim().replace(/\s+/g,' ')||'',get=s=>doc.querySelector(s);switch(type){case'status':return doc.documentElement.lang==='ru'&&get('meta[charset]')?.getAttribute('charset').toLowerCase()==='utf-8'&&doc.querySelectorAll('h1').length===1&&txt(get('h1'))==='Статус сервера'&&[...doc.querySelectorAll('p')].some(e=>txt(e)==='Сервер работает');case'list':return txt(get('h1'))==='Резервное копирование'&&JSON.stringify([...doc.querySelectorAll('ol > li')].map(txt))===JSON.stringify(['Проверить место','Создать копию','Проверить восстановление']);case'link':{const a=[...doc.querySelectorAll('a')].find(e=>txt(e)==='Документация');return!!a&&/^https:\/\/developer\.mozilla\.org\/?$/.test(a.getAttribute('href'))&&a.target==='_blank'&&a.relList.contains('noopener')&&a.relList.contains('noreferrer');}case'form':{const input=get('form input#email');return!!input&&input.type==='email'&&input.name==='email'&&input.required&&txt(get('form label[for="email"]'))==='Рабочая почта'&&[...doc.querySelectorAll('form button[type="submit"]')].some(e=>txt(e)==='Отправить');}case'escape':return!get('script')&&txt(get('pre > code'))==='<script>alert(1)</script>';case'table':{const table=get('table');return!!table&&txt(table.querySelector('caption'))==='Сервисы'&&JSON.stringify([...table.querySelectorAll('th[scope="col"]')].map(txt))===JSON.stringify(['Сервис','Порт'])&&JSON.stringify([...table.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('td')].map(txt)).filter(r=>r.length))===JSON.stringify([['SSH','22'],['HTTPS','443']]);}default:return false;}}
function checkRules(code,rules){
 if(!Array.isArray(rules)||!rules.length)return false;
 const doc=new DOMParser().parseFromString(code,'text/html');
 const normalize=v=>String(v??'').trim().replace(/\s+/g,' ');
 return rules.every(rule=>{
  const elements=[...doc.querySelectorAll(rule.selector)];
  if(rule.count!==undefined&&elements.length!==rule.count)return false;
  if(rule.count===0)return true;
  if(!elements.length)return false;
  if(rule.templateSelector)return elements.some(el=>el.content&&[...el.content.querySelectorAll(rule.templateSelector)].some(child=>rule.text===undefined||normalize(child.textContent)===normalize(rule.text)));
  return rule.text===undefined||elements.some(el=>normalize(el.textContent)===normalize(rule.text));
 });
}
function validateImport(data,lessons){
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v), fail=()=>{throw Error('Неверный или повреждённый файл прогресса.');}, ids=new Set(lessons.map(l=>l.id));
 if(!object(data)||![1,2].includes(data.version)||!object(data.statuses)||!object(data.drafts)||!Array.isArray(data.events)||data.events.length>5000||![5,15,30,45].includes(data.minutes)||!['auto','python','cpp','html'].includes(data.track)||(data.active!==null&&!ids.has(data.active)))fail();
 const state=initial();state.minutes=data.minutes;state.track=data.track;state.active=data.active;
 const validStatus=s=>object(s)&&['tested','self'].includes(s.source)&&typeof s.at==='string'&&!Number.isNaN(Date.parse(s.at));
 for(const [id,status] of Object.entries(data.statuses)){if(!ids.has(id)||!validStatus(status))fail();state.statuses[id]={source:status.source,at:status.at};}
 for(const [id,d] of Object.entries(data.drafts)){if(!ids.has(id)||!object(d)||typeof d.code!=='string'||d.code.length>50000||typeof d.output!=='string'||d.output.length>5000||!Number.isInteger(d.hint)||d.hint<0||d.hint>2||typeof d.started!=='boolean')fail();state.drafts[id]={code:d.code,output:d.output,hint:d.hint,started:d.started,passed:false};}
 state.events=data.events.map(e=>{if(!validStatus(e)||!ids.has(e.id))fail();return{id:e.id,source:e.source,at:e.at};});return state;
}
root.PracticeCore={initial,nextLessons,recommend,checkOutput,checkHtml,checkRules,validateImport};
})(typeof window!=='undefined'?window:globalThis);
