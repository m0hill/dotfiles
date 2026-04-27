import { FileDiff, parsePatchFiles, type FileDiffMetadata, type SelectedLineRange } from '@pierre/diffs';
import './style.css';

type DiffSession = { id: string; title: string; mode: string; patch: string; base?: string; commit?: string };
type Ann = {
  id: string;
  file: string;
  scope: 'lines' | 'file';
  side?: string;
  start?: number;
  end?: number;
  quote: string;
  comment: string;
};
type Selection = { file: FileDiffMetadata; scope: 'lines' | 'file'; range?: SelectedLineRange | null; start?: number; end?: number; side?: string; quote: string };

const DIFF_UNSAFE_CSS = `
:host {
  --diffs-font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --diffs-font-size: 13px;
  --diffs-line-height: 1.62;
  --diffs-header-font-family: Inter, system-ui, sans-serif;
  --diffs-addition-color-override: #22c55e;
  --diffs-deletion-color-override: #ef4444;
  --diffs-selection-color-override: #60a5fa;
  --diffs-bg-selection-override: rgba(96, 165, 250, 0.22);
  --diffs-bg-selection-number-override: rgba(96, 165, 250, 0.45);
}
[data-file] { background: #0f0f0f; }
[data-diffs-header] { background: #111111; border-bottom: 1px solid #262626; }
[data-column-number] { color: #737373; background: #0c0c0c; }
[data-line] { border-bottom: 1px solid rgba(255,255,255,0.025); }
[data-error-wrapper] { background: #111111; color: #F6FFF5; }
`;

const app = document.querySelector<HTMLDivElement>('#app')!;
const id = new URLSearchParams(location.search).get('id') || '';
let review: DiffSession;
let files: FileDiffMetadata[] = [];
let diffStyle: 'split' | 'unified' = 'split';
let annotations: Ann[] = [];
let currentSelection: Selection | null = null;
const instances: FileDiff[] = [];

function esc(s: string) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)); }
function fileName(file: FileDiffMetadata) { return (file as any).name || 'file'; }
function lineLabel(a: { scope?: string; side?: string; start?: number; end?: number }) {
  if (a.scope === 'file') return 'entire file';
  return [a.side, a.start ? `lines ${a.start}${a.end && a.end !== a.start ? `-${a.end}` : ''}` : ''].filter(Boolean).join(' ');
}
function rangeLines(r?: SelectedLineRange | null) {
  return { start: (r as any)?.start, end: (r as any)?.end || (r as any)?.start, side: (r as any)?.side || (r as any)?.endSide || 'additions' };
}
function stats() {
  let additions = 0, deletions = 0;
  for (const f of files) { additions += ((f as any).additionLines?.length ?? 0); deletions += ((f as any).deletionLines?.length ?? 0); }
  return { files: files.length, additions, deletions };
}

function quoteForRange(file: FileDiffMetadata, side?: string, start?: number, end?: number): string {
  if (!start) return '';
  const rawLines = side === 'deletions' ? (file as any).deletionLines : (file as any).additionLines;
  if (Array.isArray(rawLines) && rawLines.length) {
    const prefix = side === 'deletions' ? '-' : '+';
    return rawLines.slice(Math.max(0, start - 1), end || start).map((line: string) => prefix + String(line).replace(/\n$/, '')).join('\n');
  }
  return `${fileName(file)} ${lineLabel({ side, start, end })}`;
}
function updateSelectionQuote() {
  if (!currentSelection || currentSelection.scope === 'file') return;
  currentSelection.quote = quoteForRange(currentSelection.file, currentSelection.side, currentSelection.start, currentSelection.end);
}

function renderShell() {
  const s = stats();
  app.innerHTML = `
    <header id="topbar">
      <div id="topbar-title"><span class="prompt">›</span><div><h1 id="title">DIFF</h1><div id="subtitle">${esc(review.title)}</div></div></div>
      <div id="topbar-stats"><span>${s.files} files</span><span class="add">+${s.additions}</span><span class="del">-${s.deletions}</span><span>${esc(review.mode)}</span></div>
      <div id="topbar-actions"><button id="toggle">${diffStyle === 'split' ? 'Unified' : 'Split'}</button><button id="send" class="primary">Send Feedback</button></div>
    </header>
    <div id="shell">
      <aside class="sidebar" id="sidebar-left"><div class="sb-head"><span class="sb-label">Files</span><button class="sb-toggle" id="leftToggle">‹</button></div><div class="sb-scroll"><nav id="files"></nav></div></aside>
      <div id="diff-wrap"><div id="diff-bar"><span class="doc-bar-label">Diff</span><span class="hint">drag line numbers for ranges · use file actions for full-file comments</span></div><section id="diffs"></section></div>
      <aside class="sidebar" id="sidebar-right"><div class="sb-head"><span class="sb-label">Diff</span><div class="sb-head-actions"><span class="anno-badge" id="count">0</span><button class="sb-toggle" id="rightToggle">›</button></div></div><div id="sb-right-inner">
        <div class="rsec"><div class="rsec-head"><span class="rsec-label">Global Feedback</span></div><div class="rsec-body"><textarea id="global" placeholder="Overall diff notes…"></textarea></div></div>
        <div class="rsec"><div class="rsec-head"><span class="rsec-label">Selection</span></div><div id="selection" class="rsec-body"><div class="no-anno">select lines or choose a file action</div></div></div>
        <div class="rsec rsec-annotations"><div class="rsec-head"><span class="rsec-label">Annotations</span></div><div id="anns" class="rsec-body"></div></div>
      </div></aside>
    </div>`;
  document.querySelector('#toggle')!.addEventListener('click', () => { diffStyle = diffStyle === 'split' ? 'unified' : 'split'; renderShell(); renderDiffs(); renderAnnotations(); });
  document.querySelector('#send')!.addEventListener('click', sendFeedback);
  document.querySelector('#leftToggle')!.addEventListener('click', () => document.body.classList.toggle('lc'));
  document.querySelector('#rightToggle')!.addEventListener('click', () => document.body.classList.toggle('rc'));
}

type TreeNode = { dirs: Map<string, TreeNode>; files: Array<{ file: FileDiffMetadata; index: number }> };
function fileIcon(file: FileDiffMetadata): { icon: string; cls: string; title: string } {
  switch ((file as any).type) {
    case 'new': return { icon: '+', cls: 'ico-add', title: 'added' };
    case 'deleted': return { icon: '−', cls: 'ico-del', title: 'deleted' };
    case 'rename-pure':
    case 'rename-changed': return { icon: '↪', cls: 'ico-ren', title: 'renamed' };
    default: return { icon: '✎', cls: 'ico-mod', title: 'modified' };
  }
}
const MAX_TREE_DEPTH = 6;
function visualDepth(depth: number): number { return Math.min(depth, MAX_TREE_DEPTH); }
function compressDir(name: string, node: TreeNode): { name: string; node: TreeNode } {
  let label = name;
  let current = node;
  while (current.files.length === 0 && current.dirs.size === 1) {
    const [[childName, childNode]] = current.dirs.entries();
    label += `/${childName}`;
    current = childNode;
  }
  return { name: label, node: current };
}
function renderTree(node: TreeNode, depth = 0): string {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
  const fs = node.files.sort((a, b) => fileName(a.file).localeCompare(fileName(b.file)));
  return [
    ...dirs.map(([name, child]) => {
      const compressed = compressDir(name, child);
      return `<div class="tree-dir" style="--depth:${visualDepth(depth)}" title="${esc(compressed.name)}"><span class="tree-twist">▾</span><span>${esc(compressed.name)}</span></div>${renderTree(compressed.node, depth + 1)}`;
    }),
    ...fs.map(({ file, index }) => {
      const icon = fileIcon(file);
      const base = fileName(file).split('/').pop() || fileName(file);
      const adds = (file as any).additionLines?.length ?? 0;
      const dels = (file as any).deletionLines?.length ?? 0;
      const stat = `${adds ? `<span class="add">+${adds}</span>` : ''}${dels ? `<span class="del">-${dels}</span>` : ''}`;
      return `<a class="tree-file" style="--depth:${visualDepth(depth)}" href="#file-${index}" title="${esc(fileName(file))}"><span class="file-ico ${icon.cls}" title="${icon.title}">${icon.icon}</span><span class="tree-name">${esc(base)}</span><span class="tree-stat">${stat}</span></a>`;
    }),
  ].join('');
}
function renderFileList() {
  const root: TreeNode = { dirs: new Map(), files: [] };
  files.forEach((file, index) => {
    const parts = fileName(file).split('/').filter(Boolean);
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push({ file, index });
  });
  document.querySelector('#files')!.innerHTML = renderTree(root);
}

function makeOptions(file: FileDiffMetadata) {
  return {
    theme: { dark: 'github-dark-default', light: 'github-light-default' },
    themeType: 'dark' as const,
    unsafeCSS: DIFF_UNSAFE_CSS,
    diffStyle,
    diffIndicators: 'bars' as const,
    hunkSeparators: 'line-info-basic' as const,
    overflow: 'wrap' as const,
    enableLineSelection: true,
    enableGutterUtility: true,
    lineHoverHighlight: 'both' as const,
    onLineSelected(range: SelectedLineRange | null) { setLineSelection(file, range); },
    onLineSelectionEnd(range: SelectedLineRange | null) { setLineSelection(file, range); },
    onGutterUtilityClick(range: SelectedLineRange) { setLineSelection(file, range); },
    renderAnnotation(annotation: any) {
      const div = document.createElement('div');
      div.className = 'inline-ann';
      div.textContent = annotation.metadata?.comment || 'Annotation';
      return div;
    },
  };
}

function renderDiffs() {
  instances.forEach(i => i.cleanUp()); instances.length = 0;
  renderFileList();
  const root = document.querySelector('#diffs')!;
  root.innerHTML = '';
  files.forEach((file, i) => {
    const outer = document.createElement('div');
    outer.className = 'file-wrap'; outer.id = `file-${i}`;
    outer.innerHTML = `<div class="file-top"><strong>${esc(fileName(file))}</strong><div class="file-top-actions"><button data-comment>Comment file</button><button data-ask>Ask about file</button></div></div><div class="diff-mount"></div>`;
    root.appendChild(outer);
    outer.querySelector('[data-comment]')!.addEventListener('click', () => setFileSelection(file, 'comment'));
    outer.querySelector('[data-ask]')!.addEventListener('click', () => setFileSelection(file, 'ask'));
    const mount = outer.querySelector('.diff-mount') as HTMLElement;
    mount.style.setProperty('--diffs-bg', '#0f0f0f');
    mount.style.setProperty('--diffs-fg', '#F6FFF5');
    const instance = new FileDiff(makeOptions(file));
    instances.push(instance);
    instance.render({ fileDiff: file, containerWrapper: mount, lineAnnotations: annotations.filter(a => a.file === fileName(file) && a.scope === 'lines' && a.start).map(a => ({ side: (a.side || 'additions') as any, lineNumber: a.start!, metadata: { comment: a.comment } })) });
  });
}

function setLineSelection(file: FileDiffMetadata, range?: SelectedLineRange | null) {
  const rr = rangeLines(range);
  currentSelection = { file, scope: 'lines', range, start: rr.start, end: rr.end, side: rr.side, quote: quoteForRange(file, rr.side, rr.start, rr.end) };
  renderSelectionChooser();
}
function setFileSelection(file: FileDiffMetadata, preferred: 'comment' | 'ask' = 'comment') {
  currentSelection = { file, scope: 'file', quote: `[entire file diff: ${fileName(file)}]` };
  renderSelectionChooser(preferred);
}

function sideClass(side?: string) {
  return side === 'deletions' ? 'selection-side-del' : side === 'additions' ? 'selection-side-add' : 'selection-side-neutral';
}
function selectionDetailsHtml(selection: Selection): string {
  const name = fileName(selection.file);
  if (selection.scope === 'file') {
    return `<div class="selection-meta">
      <div class="selection-row"><span>Scope</span><strong class="selection-scope">Entire file</strong></div>
      <div class="selection-row"><span>File</span><code title="${esc(name)}">${esc(name)}</code></div>
    </div>`;
  }
  const side = selection.side || 'additions';
  const lines = selection.start ? `${selection.start}${selection.end && selection.end !== selection.start ? `–${selection.end}` : ''}` : 'unknown';
  return `<div class="selection-meta">
    <div class="selection-row"><span>File</span><code title="${esc(name)}">${esc(name)}</code></div>
    <div class="selection-row"><span>Side</span><strong class="selection-side ${sideClass(side)}">${esc(side)}</strong></div>
    <div class="selection-row"><span>Lines</span><strong>${esc(lines)}</strong></div>
  </div>${selection.quote ? `<div class="quote selection-quote">${esc(selection.quote)}</div>` : ''}`;
}

function renderSelectionChooser(preferred?: 'comment' | 'ask') {
  const sel = document.querySelector('#selection')!;
  if (!currentSelection) return;
  sel.innerHTML = `<div class="selection-card">${selectionDetailsHtml(currentSelection)}<div class="mode-switch" role="tablist" aria-label="Selection action"><button id="chooseComment" class="mode-option" type="button">Comment</button><button id="chooseAsk" class="mode-option" type="button">Ask Pi</button></div><div id="actionBox"></div></div>`;
  document.querySelector('#chooseComment')!.addEventListener('click', () => { setMode('comment'); renderCommentBox(); });
  document.querySelector('#chooseAsk')!.addEventListener('click', () => { setMode('ask'); renderAskBox(); });
  if (preferred === 'ask') { setMode('ask'); renderAskBox(); } else { setMode('comment'); renderCommentBox(); }
}
function setMode(mode: 'comment' | 'ask') {
  document.querySelector('#chooseComment')?.classList.toggle('active', mode === 'comment');
  document.querySelector('#chooseAsk')?.classList.toggle('active', mode === 'ask');
}
function renderCommentBox() {
  const box = document.querySelector('#actionBox')!;
  box.innerHTML = `<textarea id="comment" class="comment-editor" placeholder="Add a diff comment…"></textarea><button id="add" class="primary">Add Annotation</button>`;
  document.querySelector('#add')!.addEventListener('click', addAnnotation);
}
function renderAskBox() {
  const box = document.querySelector('#actionBox')!;
  box.innerHTML = `<textarea id="question" placeholder="Ask Pi about this selection…"></textarea><button id="ask" class="primary">Ask Pi</button><div id="askStatus" class="hint"></div>`;
  document.querySelector('#ask')!.addEventListener('click', askPi);
}

function clearSelectionInputs() {
  const comment = document.querySelector('#comment') as HTMLTextAreaElement | null;
  const question = document.querySelector('#question') as HTMLTextAreaElement | null;
  if (comment) comment.value = '';
  if (question) question.value = '';
  const status = document.querySelector('#askStatus') as HTMLElement | null;
  if (status) status.textContent = '';
}

function addAnnotation() {
  if (!currentSelection) return;
  const comment = (document.querySelector('#comment') as HTMLTextAreaElement).value.trim();
  if (!comment) return;
  annotations.push({ id: crypto.randomUUID(), file: fileName(currentSelection.file), scope: currentSelection.scope, side: currentSelection.side, start: currentSelection.start, end: currentSelection.end, quote: currentSelection.quote, comment });
  renderAnnotations(); renderDiffs(); clearSelectionInputs();
}

function annotationTone(annotation: Ann): string {
  if (annotation.scope === 'file') return 'annotation-file';
  if (annotation.side === 'deletions') return 'annotation-del';
  if (annotation.side === 'additions') return 'annotation-add';
  return 'annotation-neutral';
}
function crossIcon(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>`;
}
function renderAnnotations() {
  const count = document.querySelector('#count'); if (count) count.textContent = String(annotations.length);
  const root = document.querySelector('#anns'); if (!root) return;
  root.innerHTML = annotations.map((a, i) => `<div class="card annotation-card ${annotationTone(a)}" role="button" tabindex="0" data-jump="${i}"><button data-del="${i}" class="icon-btn close-btn" aria-label="Delete annotation">${crossIcon()}</button><div class="anno-top"><span class="anno-file" title="${esc(a.file)}">${esc(a.file)}</span></div><div class="anno-loc">${esc(lineLabel(a))}</div><div class="comment anno-comment">${esc(a.comment)}</div></div>`).join('') || '<div class="no-anno">no annotations yet</div>';
  root.querySelectorAll('[data-jump]').forEach(card => {
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-del]')) return;
      jumpToAnnotation(annotations[Number((card as HTMLElement).dataset.jump)]);
    });
    card.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') jumpToAnnotation(annotations[Number((card as HTMLElement).dataset.jump)]);
    });
  });
  root.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => { annotations.splice(Number((btn as HTMLElement).dataset.del), 1); renderAnnotations(); renderDiffs(); }));
}

function jumpToAnnotation(annotation: Ann | undefined) {
  if (!annotation) return;
  const index = files.findIndex((file) => fileName(file) === annotation.file);
  if (index < 0) return;
  document.querySelector(`#file-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function sendFeedback() {
  const globalComment = (document.querySelector('#global') as HTMLTextAreaElement).value.trim();
  if (!annotations.length && !globalComment) return alert('Add annotations or global feedback first.');
  await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: review.id, annotations, globalComment }) });
  alert('Feedback sent to Pi.');
}
async function askPi() {
  if (!currentSelection) return;
  const question = (document.querySelector('#question') as HTMLTextAreaElement).value.trim();
  if (!question) return;
  const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: review.id, file: fileName(currentSelection.file), scope: currentSelection.scope, side: currentSelection.side, start: currentSelection.start, end: currentSelection.end, quote: currentSelection.quote, question }) });
  const json = await res.json();
  (document.querySelector('#askStatus') as HTMLElement).textContent = json.message || 'Question sent to Pi. Check the terminal.';
}

async function boot() {
  app.innerHTML = '<div class="loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>loading diff…</span></div>';
  const res = await fetch('/api/review?id=' + encodeURIComponent(id));
  review = await res.json();
  if (!res.ok) throw new Error((review as any).error || 'Failed to load diff');
  const patches = parsePatchFiles(review.patch, review.id, false) as any[];
  files = patches.flatMap((patch) => Array.isArray(patch?.files) ? patch.files : [patch]).filter(Boolean) as FileDiffMetadata[];
  renderShell(); renderDiffs(); renderAnnotations();
}
boot().catch(e => { app.innerHTML = `<pre class="full-msg">${esc(String(e.message || e))}</pre>`; });
