document.documentElement.dataset.theme='dark';

const params=new URLSearchParams(location.search), id=params.get('id');
const docEl=document.getElementById('doc'), titleEl=document.getElementById('title');
const sourceEl=document.getElementById('source'), popover=document.getElementById('popover');
const selPreview=document.getElementById('selPreview'), commentInput=document.getElementById('commentInput');
const annotationsEl=document.getElementById('annotations'), countEl=document.getElementById('count');
let annotations=[], selectedQuote='';

function updateToggles(){
  const lc=document.body.classList.contains('lc'), rc=document.body.classList.contains('rc');
  document.getElementById('leftToggle').textContent=lc?'›':'‹';
  document.getElementById('rightToggle').textContent=rc?'‹':'›';
}
document.getElementById('leftToggle').onclick=()=>{ document.body.classList.toggle('lc'); localStorage.setItem('ann-lc',document.body.classList.contains('lc')?'1':'0'); updateToggles(); };
document.getElementById('rightToggle').onclick=()=>{ document.body.classList.toggle('rc'); localStorage.setItem('ann-rc',document.body.classList.contains('rc')?'1':'0'); updateToggles(); };
if(localStorage.getItem('ann-lc')==='1') document.body.classList.add('lc');
if(localStorage.getItem('ann-rc')==='1') document.body.classList.add('rc');
updateToggles();

function esc(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function renderMd(md){ if(!window.marked||!window.DOMPurify) return `<pre>${esc(md)}</pre>`; marked.setOptions({gfm:true,breaks:false}); return DOMPurify.sanitize(marked.parse(md)); }
function slugify(t,m){ const b=t.toLowerCase().replace(/<[^>]+>/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-')||'h'; const n=m.get(b)||0; m.set(b,n+1); return n?`${b}-${n}`:b; }

function buildTOC(){
  const toc=document.getElementById('toc'), hs=[...docEl.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  if(!hs.length){ toc.innerHTML='<div class="toc-empty">no headings</div>'; return; }
  const m=new Map();
  toc.innerHTML=hs.map(h=>{ const l=+h.tagName[1]; if(!h.id) h.id=slugify(h.textContent||'h',m); return `<a href="#${h.id}" data-level="${l}" title="${esc(h.textContent)}">${esc(h.textContent)}</a>`; }).join('');
}

function renderAnnotations(){
  countEl.textContent=annotations.length;
  if(!annotations.length){ annotationsEl.innerHTML='<div class="no-anno">no annotations yet</div>'; return; }
  annotationsEl.innerHTML=annotations.map((a,i)=>`
    <div class="card">
      <div class="card-num">#${String(i+1).padStart(2,'0')}</div>
      ${a.quote?`<div class="quote">${esc(a.quote.length>280?a.quote.slice(0,280)+'…':a.quote)}</div>`:''}
      ${a.comment?`<div class="comment">${esc(a.comment)}</div>`:''}
      <div class="card-foot"><button class="danger" data-i="${i}">Delete</button></div>
    </div>`).join('');
  annotationsEl.querySelectorAll('[data-i]').forEach(b=>{ b.onclick=()=>{ annotations.splice(+b.dataset.i,1); renderAnnotations(); }; });
}

function hidePopover(){ popover.style.display='none'; selectedQuote=''; commentInput.value=''; }

document.addEventListener('mouseup',()=>{
  const sel=window.getSelection(), text=sel?.toString().trim();
  if(!text||!docEl.contains(sel.anchorNode)) return;
  selectedQuote=text;
  selPreview.textContent=text.length>360?text.slice(0,360)+'…':text;
  const r=sel.getRangeAt(0).getBoundingClientRect();
  popover.style.left=Math.min(Math.max(r.left,8),window.innerWidth-348)+'px';
  popover.style.top=Math.min(r.bottom+10,window.innerHeight-240)+'px';
  popover.style.display='flex';
  setTimeout(()=>commentInput.focus(),0);
});
document.addEventListener('mousedown',e=>{ if(popover.style.display==='flex'&&!popover.contains(e.target)) hidePopover(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') hidePopover(); });

document.getElementById('cancelAdd').onclick=hidePopover;
document.getElementById('addBtn').onclick=()=>{
  const c=commentInput.value.trim();
  if(!selectedQuote&&!c) return;
  annotations.push({quote:selectedQuote,comment:c});
  hidePopover(); window.getSelection()?.removeAllRanges(); renderAnnotations();
};

document.getElementById('submitBtn').onclick=async()=>{
  const g=document.getElementById('global').value.trim();
  if(!annotations.length&&!g){ alert('Add an annotation or global feedback first.'); return; }
  try{
    await fetch('/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,annotations,globalComment:g})});
    document.body.innerHTML='<div class="full-msg"><h2>Feedback Sent</h2><p>You may close this tab</p></div>';
  }catch{ alert('Submission failed.'); }
};

document.getElementById('closeBtn').onclick=async()=>{
  try{ await fetch('/api/close',{method:'POST'}); }catch{}
  window.close();
  document.body.innerHTML='<div class="full-msg"><h2>Session Closed</h2><p>You may close this tab</p></div>';
};

(async()=>{
  try{
    const res=await fetch('/api/doc?id='+encodeURIComponent(id||''));
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'failed to load');
    titleEl.textContent=data.title||'ANNOTATOR_TERMINAL';
    sourceEl.textContent=data.sourcePath||(data.kind==='last'?'last assistant response':'');
    docEl.innerHTML=renderMd(data.markdown||'');
    buildTOC(); renderAnnotations();
  }catch(e){ docEl.innerHTML=`<span style="color:var(--danger)">error: ${esc(e.message)}</span>`; }
})();
