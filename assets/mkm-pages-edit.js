const escapeCell = value => value.replace(/(?<!\\)\|/g, '\\|').replace(/\r?\n/g, ' ');
const splitCells = line => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim());

function renderEditor({ root, source, publicUrl, update }) {
 const parts = source.split(/(\n[\t ]*\n(?:[\t ]*\n)*)/);
 root.replaceChildren();
 const text = (parent, value, label, commit, className = '') => {
  const box = document.createElement('textarea');
  box.rows = 1; box.value = value; box.className = className;
  box.setAttribute('aria-label', label);
  const resize = () => { box.style.height = 'auto'; box.style.height = box.scrollHeight + 2 + 'px'; };
  box.addEventListener('input', () => { resize(); commit(box.value); update(parts.join('')); });
  parent.append(box);
  window.requestAnimationFrame(resize);
  return box;
 };
 const media = (cell, value) => {
  const references = [...value.matchAll(/(!?)\[([^\]]+)\]\(\.\/(media\/\d+\.(?:jpg|png|webp|gif|mp4))\)/g)];
  if (!references.length) return false;
  for (const [, image, label, file] of references) {
   const asset = document.createElement(image ? 'img' : file.endsWith('.mp4') ? 'video' : 'a');
   asset.href = new URL(file, publicUrl).href;
   if (image) { asset.src = asset.href; asset.alt = label; asset.loading = 'lazy'; }
   else if (asset.tagName === 'VIDEO') { asset.src = asset.href; asset.controls = true; asset.preload = 'none'; asset.setAttribute('aria-label', label); }
   else { asset.textContent = label; asset.target = '_blank'; asset.rel = 'noopener noreferrer'; }
   cell.append(asset);
  }
  return true;
 };
 const table = (block, value, replace) => {
  const lines = value.split('\n');
  if (lines.length < 3 || lines.some(line => !/^\s*\|.*\|\s*$/.test(line))) return false;
  const rows = lines.map(splitCells);
  const columnCount = rows[0].length;
  if (rows.some(row => row.length !== columnCount) || rows[1].some(cell => !/^:?-{3,}:?$/.test(cell))) return false;
  for (const [index, row] of rows.entries()) {
   if (index === 1) continue;
   const line = document.createElement('div'); line.className = 'mkm-share-edit-row';
   line.style.setProperty('--edit-columns', columnCount);
   for (const [column, value] of row.entries()) {
    const cell = document.createElement('div'); line.append(cell);
    if (index === 0) { cell.textContent = value; continue; }
    if (media(cell, value)) continue;
    const metrics = value.split(' · ').map(part => part.match(/^\*\*([^*]+)\*\*\s+(.+)$/));
    const updateCell = next => {
     row[column] = escapeCell(next);
     lines[index] = '| ' + row.join(' | ') + ' |';
     replace(lines.join('\n'));
    };
    if (metrics.length > 1 && metrics.every(Boolean)) {
     cell.className = 'mkm-share-metrics';
     for (const [, key, amount] of metrics) {
      const label = document.createElement('label'); label.textContent = key; cell.append(label);
      const field = text(label, amount, key, () => updateCell(Array.from(cell.querySelectorAll('label')).map(item =>
       '**' + item.firstChild.textContent + '** ' + item.querySelector('textarea').value.trim()).join(' · ')));
      field.maxLength = 80;
     }
    } else text(cell, value, rows[0][column] || '표 내용', updateCell);
   }
   block.append(line);
  }
  return true;
 };
 for (let index = 0; index < parts.length; index += 2) {
  const value = parts[index];
  if (!value.trim()) continue;
  const block = document.createElement('div'); block.className = 'mkm-share-edit-block'; root.append(block);
  const replace = next => { parts[index] = next; };
  const heading = value.match(/^(#{1,6}) (.+)$/);
  if (heading) {
   const box = text(block, heading[2], '제목', next => replace(heading[1] + ' ' + next.replace(/\r?\n/g, ' ')), 'mkm-share-edit-title');
   box.dataset.level = heading[1].length;
  } else if (!table(block, value, replace) && !media(block, value)) {
   text(block, value, '본문 문단', replace);
  }
 }
}

const app = document.querySelector('#mkm-pages-editor');
const {brand, id, repo, origin: mkmOrigin} = app.dataset;
const latestUrl = new URL(app.dataset.latest, location.origin);
const toolbar = app.querySelector('nav');
const edit = app.querySelector('[data-edit]');
const save = app.querySelector('[data-save]');
const close = app.querySelector('[data-close]');
const panel = app.querySelector('[data-editor]');
const blocks = app.querySelector('[data-blocks]');
const status = app.querySelector('[data-status]');
const view = app.querySelector('[data-view]');
const rawRoot = `https://raw.githubusercontent.com/${repo}/main/${id}/`;
const draftKey = `mkm-public-editor:${repo}:${id}`;
const appOrigin = new URL(mkmOrigin).origin;
let baseline, draft, popup, handshake;

function buttons() {
 save.disabled = Boolean(handshake) || !draft?.trim() || draft.trim() === baseline?.body.trim();
}

async function getRaw(path) {
 const response = await fetch(rawRoot + path, {cache:'no-store', credentials:'omit'});
 if (!response.ok) throw new Error('공개 문서의 원본을 불러오지 못했습니다.');
 return response;
}

async function gitSha(source) {
 const encoder = new TextEncoder();
 const size = encoder.encode(source).byteLength;
 const bytes = encoder.encode('blob ' + size + '\0' + source);
 return [...new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function setDraft(value) {
 draft = value;
 try {
  if (draft.trim() !== baseline.body.trim()) {
   sessionStorage.setItem(draftKey, JSON.stringify({sha:baseline.sha, draft}));
   status.textContent = '이 탭에 초안 저장됨';
  } else {
   sessionStorage.removeItem(draftKey);
   status.textContent = `v${baseline.version} 공개본`;
  }
 } catch { status.textContent = '수정 중'; }
 buttons();
}

edit.onclick = async () => {
 if (location.pathname !== latestUrl.pathname) {
  latestUrl.hash = 'edit';
  location.assign(latestUrl);
  return;
 }
 edit.disabled = true;
 try {
  if (!baseline) {
   const [source, metadata] = await Promise.all([getRaw('index.md').then(r => r.text()), getRaw('mkm-share.json').then(r => r.json())]);
   const header = source.match(/^---\ntitle: "[^\n]*"\n---\n/)?.[0];
   if (!header || metadata.brand !== brand || !Number.isSafeInteger(metadata.version) || metadata.version < 1) throw new Error('편집할 수 있는 공개 문서를 확인하지 못했습니다.');
   baseline = {body:source.slice(header.length), header, version:metadata.version, sha:await gitSha(source)};
   draft = baseline.body;
   try {
    const stored = JSON.parse(sessionStorage.getItem(draftKey));
    if (stored?.sha === baseline.sha && typeof stored.draft === 'string') draft = stored.draft;
   } catch { /* The public document stays editable without browser storage. */ }
  }
  panel.hidden = false;
  view.hidden = true;
  edit.hidden = true;
  save.hidden = false;
  close.hidden = false;
  renderEditor({root:blocks, source:draft, publicUrl:latestUrl.href, update:setDraft});
  setDraft(draft);
  toolbar.scrollIntoView({block:'start'});
 } catch (error) { status.textContent = error.message; }
 finally { edit.disabled = false; }
};

close.onclick = () => {
 panel.hidden = true;
 view.hidden = false;
 edit.hidden = false;
 save.hidden = true;
 close.hidden = true;
};

function stopWaiting() {
 clearInterval(handshake.timer);
 handshake = null;
 popup = null;
 buttons();
}

save.onclick = () => {
 if (save.disabled) return;
 const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
 const confirm = new URL('/github-share/confirm', appOrigin);
 confirm.search = new URLSearchParams({brand, id, nonce});
 popup = window.open(confirm.href, '_blank', 'popup,width=670,height=650');
 if (!popup) { status.textContent = '팝업을 허용한 뒤 저장을 다시 눌러 주세요. 이 탭에 초안을 유지합니다.'; return; }
 const submission = {type:'mkm-share-revision', nonce, id, source:draft, sha:baseline.sha, version:baseline.version};
 handshake = {submission, timer:setInterval(() => {
  if (!popup.closed) return;
  stopWaiting();
  status.textContent = '저장 결과를 받지 못했습니다. 이미 저장을 눌렀다면 최신본을 먼저 확인해 주세요. 로그인만 했다면 다시 저장을 눌러 주세요.';
 }, 1000)};
 buttons();
 status.textContent = '확인 창에서 MKM 로그인과 공개 저장을 완료해 주세요.';
};

window.addEventListener('message', async event => {
 const data = event.data;
 if (!handshake || event.origin !== appOrigin || event.source !== popup || data?.nonce !== handshake.submission.nonce || data.id !== id) return;
 if (data.type === 'mkm-share-ready') { popup.postMessage(handshake.submission, appOrigin); return; }
 if (data.type === 'mkm-share-error') {
  stopWaiting();
  status.textContent = '저장을 완료하지 못했습니다. 확인 창의 안내를 확인해 주세요. 초안은 이 탭에 남아 있습니다.';
  return;
 }
 if (data.type !== 'mkm-share-saved' || data.version !== handshake.submission.version + 1) return;
 const saved = handshake.submission.source;
 const body = saved.trim() + '\n';
 baseline = {header:baseline.header, body, version:data.version, sha:await gitSha(baseline.header + body)};
 stopWaiting();
 setDraft(draft);
 const archive = document.createElement('a');
 archive.href = new URL(`v${data.version}/`, latestUrl).href;
 archive.textContent = `v${data.version} 보관본`;
 status.replaceChildren(`v${data.version} 저장 완료. GitHub Pages 게시 후 확인할 수 있습니다. `, archive);
});

if (location.hash === '#edit' && location.pathname === latestUrl.pathname) void edit.onclick();
