// MK Notes for the phone. Notes live on the phone (IndexedDB) and sync with
// MK Notes on your laptop over Wi-Fi whenever both are reachable. Same vault,
// same Markdown, same drawings. Served by the laptop (mk-notes) and bundled
// in the Android app.
'use strict';

// ---------- storage ----------
const DB = (() => {
  let db;
  const open = () => db || (db = new Promise((resolve, reject) => {
    const req = indexedDB.open('mknotes', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('files', {keyPath: 'path'});
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    all: () => tx('files', 'readonly', s => s.getAll()),
    get: path => tx('files', 'readonly', s => s.get(path)),
    put: rec => tx('files', 'readwrite', s => s.put(rec)),
    del: path => tx('files', 'readwrite', s => s.delete(path)),
    getKV: key => tx('kv', 'readonly', s => s.get(key)),
    setKV: (key, value) => tx('kv', 'readwrite', s => s.put(value, key)),
  };
})();

// ---------- SHA-1 (crypto.subtle isn't available over plain http on a LAN) ----------
function sha1(bytes) {
  const rotl = (n, s) => (n << s) | (n >>> (32 - s));
  const len = bytes.length, words = new Uint32Array(((len + 8 >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  let [a, b, c, d, e] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[i + t] : rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let [A, B, C, D, E] = [a, b, c, d, e];
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (B & C) | (~B & D) : t < 40 ? B ^ C ^ D : t < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rotl(A, 5) + f + E + k + w[t]) >>> 0;
      E = D; D = C; C = rotl(B, 30) >>> 0; B = A; A = tmp;
    }
    a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0; e = (e + E) >>> 0;
  }
  const out = new Uint8Array(20), dv = new DataView(out.buffer);
  [a, b, c, d, e].forEach((x, i) => dv.setUint32(i * 4, x));
  return out;
}
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const sha1hex = bytes => hex(sha1(bytes)).slice(0, 16);
// Requests are signed with the pairing key, which never leaves the phone.
function hmacSha1(key, message) {
  const enc = new TextEncoder();
  let k = enc.encode(key);
  if (k.length > 64) k = sha1(k);
  const pad = v => { const p = new Uint8Array(64).fill(v); k.forEach((x, i) => { p[i] ^= x; }); return p; };
  const join = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  return hex(sha1(join(pad(0x5c), sha1(join(pad(0x36), enc.encode(message))))));
}
const hashText = text => sha1hex(new TextEncoder().encode(text));
const hashBlob = async blob => sha1hex(new Uint8Array(await blob.arrayBuffer()));

// ---------- helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const stem = path => path.split('/').pop().replace(/\.md$/, '');
const folderOf = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const safeName = t => (t.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '') || 'Untitled').slice(0, 120);
const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#51cf66', '#4dabf7', '#b197fc'];
const INKS = ['#1d2330', '#ffffff', '#2f80ff', '#ff4d6d', '#2ecc8f', '#ffb020', '#9b6bff'];
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('on'), 2200);
}
function when(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  if ((now - d) / 864e5 < 7) return d.toLocaleDateString([], {weekday: 'long'});
  return d.toLocaleDateString();
}
function snippet(text) {
  for (let line of text.split('\n')) {
    line = line.trim();
    if (line && !/^(#|---|```|!\[\[)/.test(line)) return line.replace(/^[-*+>] (\[.\] )?|\*\*|==|`|\[\[|\]\]/g, '');
  }
  return 'No additional text';
}
const tagsOf = text => [...new Set((text.replace(/```[\s\S]*?```|`[^`\n]*`/g, '').match(/(?<![\w/&#])#[A-Za-z][\w/-]*/g) || []).map(t => t.slice(1).toLowerCase()))];

// ---------- state ----------
// Inside the Android app the page comes from the phone itself, not the laptop.
const BUNDLED = location.hostname === 'appassets.androidplatform.net';
const S = {server: '', key: '', pinned: [], colors: {}, files: new Map(), filter: 'all', current: null, reading: false, syncing: false};

async function load() {
  S.server = (await DB.getKV('server')) || '';
  S.key = (await DB.getKV('key')) || '';
  S.pinned = (await DB.getKV('pinned')) || [];
  S.colors = (await DB.getKV('colors')) || {};
  S.files = new Map((await DB.all()).map(f => [f.path, f]));
  // Opened from the laptop's pairing link: remember it.
  const m = location.hash.match(/key=([\w-]+)/), sv = location.hash.match(/server=([^&]+)/);
  if (m) {
    // From the laptop's QR code (browser) or the Android app's mknotes:// link.
    await pairChecked(sv ? decodeURIComponent(sv[1]) : !BUNDLED ? location.origin + '/' : S.server, m[1]);
    history.replaceState(null, '', location.pathname);
  } else if (!S.server && !BUNDLED) {
    S.server = location.origin + '/';
  }
  if (![...S.files.values()].some(f => f.kind === 'note' && !f.deleted)) {
    await saveNote('Welcome.md', '# Welcome to MK Notes\n\nWrite here, and it syncs with MK Notes on your laptop.\n\n- [ ] Try a checklist\n- [ ] Add a photo or a drawing\n', false);
  }
  renderList();
  sync();
}

// Pairing from a link: only a laptop on your own network, and only after you
// say yes when it would replace an existing pairing. A link can come from
// anywhere; it must not send your notes elsewhere or wipe them.
function privateLAN(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/.test(h) || h.endsWith('.local') || h === 'localhost';
  } catch (e) { return false; }
}
async function pairChecked(server, key) {
  if (!privateLAN(server)) { toast('That link isn\'t a laptop on your Wi-Fi: not paired'); return false; }
  const same = S.key === key && S.server.replace(/\/?$/, '/') === server.replace(/#.*$/, '').replace(/\/?$/, '/');
  if (same) return true;
  if (S.key && !confirm(`Pair with ${new URL(server).host}?\n\nThe notes on this phone will sync with that laptop from now on.`)) return false;
  if (S.key) {
    // A different laptop: everything here is new to it. Upload notes,
    // forget what the old laptop said, never delete because of it.
    for (const rec of [...S.files.values()]) {
      if (rec.deleted || (rec.kind === 'file' && !rec.blob)) { S.files.delete(rec.path); await DB.del(rec.path); continue; }
      rec.base = ''; rec.dirty = true; await DB.put(rec);
    }
  }
  await pair(server, key);
  return true;
}

async function pair(server, key) {
  S.server = server.replace(/#.*$/, '').replace(/\/?$/, '/');
  S.key = key;
  await DB.setKV('server', S.server);
  await DB.setKV('key', S.key);
}

const notes = () => [...S.files.values()].filter(f => f.kind === 'note' && !f.deleted);

async function saveNote(path, text, dirty = true) {
  const old = S.files.get(path) || {path, kind: 'note', base: ''};
  const rec = {...old, text, dirty: dirty || old.dirty, deleted: false, mtime: Date.now()};
  S.files.set(path, rec);
  await DB.put(rec);
  return rec;
}

async function removeFile(path) {
  const rec = S.files.get(path);
  if (!rec) return;
  if (rec.base) {  // known to the laptop: delete it there on the next sync
    rec.deleted = true; rec.dirty = true;
    await DB.put(rec);
  } else {
    S.files.delete(path);
    await DB.del(path);
  }
}

function uniquePath(folder, title) {
  const base = (folder ? folder + '/' : '') + safeName(title);
  let path = base + '.md', n = 1;
  while (S.files.has(path) && !S.files.get(path).deleted) path = `${base} ${++n}.md`;
  return path;
}

// ---------- sync ----------
async function api(method, path, body) {
  const stamp = String(Math.floor(Date.now() / 1000)) + '', nonce = Math.random().toString(36).slice(2, 8);
  path += (path.includes('?') ? '&' : '?') + 'n=' + nonce;  // two requests in one second still differ
  const bytes = body === undefined ? new Uint8Array() : typeof body === 'string' ? new TextEncoder().encode(body)
    : new Uint8Array(await body.arrayBuffer());
  const sig = hmacSha1(S.key, `${method} /${path} ${stamp} ${hex(sha1(bytes))}`);
  const res = await fetch(S.server + path, {method, body, headers: {'X-MK-Time': stamp, 'X-MK-Sig': sig}, cache: 'no-store'});
  if (res.status === 401) throw new Error('This phone isn\'t paired: open Settings');
  if (!res.ok && res.status !== 409) throw new Error(`Laptop said ${res.status}`);
  return res;
}

async function sync(quiet = true) {
  if (S.syncing || !S.server || !S.key) {
    if (!quiet && (!S.server || !S.key)) openSheet('settings');
    return;
  }
  S.syncing = true;
  status('Syncing…');
  try {
    const manifest = await (await api('GET', 'api/manifest')).json();
    const remote = new Map(manifest.files.map(f => [f.path, f]));
    // 1. send what changed here
    for (const rec of [...S.files.values()].filter(f => f.dirty)) {
      const q = `api/file?path=${encodeURIComponent(rec.path)}&base=${rec.base || ''}`;
      if (rec.deleted) {
        if (remote.has(rec.path)) await api('DELETE', q);
        remote.delete(rec.path);
        S.files.delete(rec.path); await DB.del(rec.path);
        continue;
      }
      const res = await (await api('PUT', q, rec.kind === 'note' ? rec.text : rec.blob)).json();
      if (res.conflict) {
        // The laptop changed it too: keep both, as Obsidian Sync does.
        const copy = {...rec, path: res.path, base: res.hash, dirty: false};
        S.files.set(copy.path, copy); await DB.put(copy);
        rec.base = ''; rec.dirty = false;  // fetch the laptop's version below
        remote.set(res.path, {path: res.path, hash: res.hash});
        toast(`Edited on both: kept “${stem(res.path)}”`);
      } else {
        rec.base = res.hash; rec.dirty = false;
        remote.set(rec.path, {path: rec.path, hash: res.hash});
      }
      await DB.put(rec);
    }
    // 2. take what changed on the laptop (attachments are fetched when shown)
    for (const [path, info] of remote) {
      const local = S.files.get(path);
      if (local && (local.dirty || local.base === info.hash)) continue;
      if (path.endsWith('.md')) {
        const text = await (await api('GET', `api/file?path=${encodeURIComponent(path)}`)).text();
        const rec = {path, kind: 'note', text, base: info.hash, dirty: false, deleted: false, mtime: (info.mtime || Date.now() / 1000) * 1000};
        S.files.set(path, rec); await DB.put(rec);
        if (S.current === path && document.activeElement !== $('#text')) openNote(path, true);
      } else {
        const rec = {path, kind: 'file', blob: null, base: info.hash, dirty: false};
        S.files.set(path, rec); await DB.put(rec);
      }
    }
    // 3. deleted on the laptop (an empty laptop is a mistake, not "delete everything")
    const synced = [...S.files.values()].filter(r => r.base && !r.dirty).length;
    if (remote.size === 0 && synced > 0) throw new Error('the laptop sent an empty vault; nothing deleted');
    for (const rec of [...S.files.values()]) {
      if (rec.base && !rec.dirty && !remote.has(rec.path)) {
        S.files.delete(rec.path); await DB.del(rec.path);
        if (S.current === rec.path) closeNote();
      }
    }
    S.pinned = manifest.pinned || []; S.colors = manifest.colors || {};
    await DB.setKV('pinned', S.pinned); await DB.setKV('colors', S.colors);
    await DB.setKV('lastSync', Date.now());
    status(`Synced ${when(Date.now())}`);
    if (!quiet) toast('Synced with your laptop');
  } catch (e) {
    status(navigator.onLine ? `Not synced: ${e.message.includes('fetch') ? 'laptop not reachable' : e.message}` : 'Offline: changes are kept on the phone');
    if (!quiet) toast(e.message.includes('fetch') ? 'Laptop not reachable (same Wi-Fi? MK Notes open?)' : e.message);
  } finally {
    S.syncing = false;
    renderList();
  }
}

function status(text) { $('#status').textContent = text; }

async function attachmentURL(name) {
  const path = name.includes('/') ? name : 'attachments/' + name;
  let rec = S.files.get(path);
  if (!rec) return null;
  if (!rec.blob && S.server && S.key) {
    try {
      rec.blob = await (await api('GET', `api/file?path=${encodeURIComponent(path)}`)).blob();
      await DB.put(rec);
    } catch (e) { return null; }
  }
  return rec.blob ? URL.createObjectURL(rec.blob) : null;
}

// ---------- list ----------
function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const all = notes();
  // chips: All, Pinned, folders, tags
  const folders = [...new Set(all.map(n => folderOf(n.path)).filter(Boolean))].sort();
  const tags = [...new Set(all.flatMap(n => tagsOf(n.text)))].sort();
  const chips = [['all', 'All'], ['pinned', '📌 Pinned'], ...folders.map(f => ['f:' + f, '📁 ' + f]), ...tags.map(t => ['t:' + t, '#' + t])];
  $('#chips').innerHTML = chips.map(([id, label]) => `<button class="chip${S.filter === id ? ' on' : ''}" data-filter="${esc(id)}">${esc(label)}</button>`).join('');
  let list = all.filter(n => {
    if (S.filter === 'pinned' && !S.pinned.includes(n.path)) return false;
    if (S.filter.startsWith('f:') && !(folderOf(n.path) + '/').startsWith(S.filter.slice(2) + '/')) return false;
    if (S.filter.startsWith('t:') && !tagsOf(n.text).some(t => t === S.filter.slice(2) || t.startsWith(S.filter.slice(2) + '/'))) return false;
    return !q || stem(n.path).toLowerCase().includes(q) || n.text.toLowerCase().includes(q);
  });
  list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  const pinned = list.filter(n => S.pinned.includes(n.path));
  const rest = list.filter(n => !S.pinned.includes(n.path));
  const row = n => `<button class="note" data-path="${esc(n.path)}"><b>${esc(stem(n.path))}</b>
    <small>${esc(when(n.mtime || 0))}  ${esc(snippet(n.text))}</small>
    ${S.colors[n.path] ? `<span class="dot" style="background:${esc(S.colors[n.path])}"></span>` : ''}
    ${n.dirty ? '<span class="pend">●</span>' : ''}</button>`;
  $('#notes').innerHTML = (pinned.length ? `<div class="section">Pinned</div><div class="group">${pinned.map(row).join('')}</div>` : '')
    + (rest.length ? `<div class="section">${pinned.length ? 'Notes' : `${rest.length} note${rest.length === 1 ? '' : 's'}`}</div><div class="group">${rest.map(row).join('')}</div>` : '')
    + (!list.length ? '<p style="text-align:center;color:var(--dim);margin-top:60px">No notes here</p>' : '');
}

// ---------- editor ----------
let saveTimer = 0;
function openNote(path, keepMode = false) {
  const rec = S.files.get(path);
  if (!rec) return;
  S.current = path;
  $('#title').value = stem(path);
  $('#text').value = rec.text;
  $('#meta').textContent = (folderOf(path) ? folderOf(path) + '  ·  ' : '') + `edited ${when(rec.mtime || 0)}`;
  if (!keepMode) setReading(rec.text.trim().length > 0);
  else if (S.reading) renderView();
  $('#list').classList.add('behind');
  $('#editor').classList.remove('hidden');
}

async function closeNote() {
  await flush();
  await commitTitle();
  S.current = null;
  $('#editor').classList.add('hidden');
  $('#list').classList.remove('behind');
  renderList();
  sync();
}

async function flush() {
  clearTimeout(saveTimer);
  if (!S.current) return;
  const rec = S.files.get(S.current);
  if (rec && rec.text !== $('#text').value) await saveNote(S.current, $('#text').value);
}

async function commitTitle() {
  if (!S.current) return;
  const title = $('#title').value.trim();
  if (!title || title === stem(S.current)) return;
  const old = S.files.get(S.current);
  const path = uniquePath(folderOf(S.current), title);
  await saveNote(path, old.text);
  if (S.pinned.includes(S.current)) S.pinned = S.pinned.map(p => p === S.current ? path : p);
  await removeFile(S.current);
  S.current = path;
}

function setReading(on) {
  S.reading = on;
  $('#text').classList.toggle('off', on);
  $('#view').classList.toggle('on', on);
  if (on) renderView();
}

// A small Markdown renderer: what notes use day to day.
function inline(s) {
  return esc(s)
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, n) => `<img data-att="${esc(n)}" alt="${esc(n)}">`)
    .replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, n, h, l) => `<a href="#" data-note="${esc(n)}">${esc(l || n)}</a>`)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/(^|[\s(])#([A-Za-z][\w/-]*)/g, '$1<span class="tag">#$2</span>');
}
function markdown(text) {
  const out = [], lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  let i = 0, task = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); i++; continue;
    }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^> ?/, ''));
      const c = quote[0].match(/^\[!(\w+)\][+-]? ?(.*)/);
      if (c) out.push(`<div class="callout"><b>${esc(c[2] || c[1])}</b>${markdown(quote.slice(1).join('\n'))}</div>`);
      else out.push(`<blockquote>${markdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\|/.test(line) && /^\|?\s*:?-/.test(lines[i + 1] || '')) {
      const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      let html = '<table><tr>' + cells(line).map(c => `<th>${c}</th>`).join('') + '</tr>';
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) html += '<tr>' + cells(lines[i++]).map(c => `<td>${c}</td>`).join('') + '</tr>';
      out.push(html + '</table>'); continue;
    }
    if (/^\s*([-*+]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.) /.test(lines[i])) {
        const body = lines[i++].replace(/^\s*([-*+]|\d+\.) /, '');
        const t = body.match(/^\[( |x|X)\] (.*)/);
        if (t) items.push(`<li class="task${t[1] !== ' ' ? ' done' : ''}"><input type="checkbox" data-task="${task++}"${t[1] !== ' ' ? ' checked' : ''}>${inline(t[2])}</li>`);
        else items.push(`<li>${inline(body)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`); continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|```|\s*([-*+]|\d+\.) |\|)/.test(lines[i])) para.push(inline(lines[i++]));
    if (!para.length) para.push(inline(lines[i++]));
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('\n');
}
async function renderView() {
  const view = $('#view');
  view.innerHTML = markdown($('#text').value);
  for (const img of view.querySelectorAll('img[data-att]')) {
    const url = await attachmentURL(img.dataset.att);
    if (url) img.src = url; else img.alt = `🖼 ${img.dataset.att} (syncs from your laptop)`;
  }
}

// ---------- formatting ----------
function edit(fn) {
  const t = $('#text'), [s, e] = [t.selectionStart, t.selectionEnd];
  const r = fn(t.value, s, e);
  t.value = r.text; t.setSelectionRange(r.s, r.e); t.focus();
  scheduleSave();
}
function wrap(before, after) { edit((v, s, e) => ({text: v.slice(0, s) + before + v.slice(s, e) + after + v.slice(e), s: s + before.length, e: e + before.length})); }
function linePrefix(prefix) {
  edit((v, s, e) => {
    const start = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(start, v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s));
    const stripped = line.replace(/^(\s*)([-*+] \[.\] |[-*+] |\d+\. |#{1,6} )/, '$1');
    const next = line.startsWith(prefix) ? stripped : prefix + stripped.trimStart();
    return {text: v.slice(0, start) + next + v.slice(start + line.length), s: s + next.length - line.length, e: e + next.length - line.length};
  });
}
function insertText(text) { edit((v, s, e) => ({text: v.slice(0, s) + text + v.slice(e), s: s + text.length, e: s + text.length})); }
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}

// Continue lists on Enter, as in Apple Notes.
$('#text').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || ev.shiftKey) return;
  const t = $('#text'), s = t.selectionStart, v = t.value;
  const start = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(start, s);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. )(.*)$/);
  if (!m) return;
  ev.preventDefault();
  if (!m[4].trim()) { edit(v2 => ({text: v2.slice(0, start) + v2.slice(s), s: start, e: start})); return; }
  const marker = m[3] ? `${+m[3] + 1}. ` : m[2].includes('[') ? m[2].slice(0, 2) + '[ ] ' : m[2];
  insertText('\n' + m[1] + marker);
});
$('#text').addEventListener('input', scheduleSave);

// Paste a screenshot straight into the note.
$('#text').addEventListener('paste', async ev => {
  const item = [...(ev.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!item) return;
  ev.preventDefault();
  await addImage(item.getAsFile(), 'Pasted image');
});

async function addImage(file, prefix = 'Photo') {
  const blob = await shrink(file);
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/svg+xml' ? '.svg' : '.jpg';
  let path = `attachments/${prefix} ${stamp}${ext}`, n = 1;
  while (S.files.has(path)) path = `attachments/${prefix} ${stamp} ${++n}${ext}`;
  const rec = {path, kind: 'file', blob, base: '', dirty: true};
  S.files.set(path, rec); await DB.put(rec);
  insertText(`\n![[${path.split('/').pop()}]]\n`);
  await flush();
  toast('Image added');
}

// Phone photos are huge: keep notes light (max 2000 px, JPEG).
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp|heic)/.test(file.type) || file.size < 600e3) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', 0.85));
  } catch (e) { return file; }
}

// ---------- drawing (same format as the laptop: SVG with editable strokes) ----------
const Draw = {strokes: [], cur: null, tool: 'pen', ink: INKS[2], width: 4, paper: 'light'};
function outline(pts, width) {
  const r = p => width * (0.35 + 0.8 * p) / 2;
  if (pts.length === 1) { const [x, y, p] = pts[0]; return [...Array(12)].map((_, i) => [x + r(p) * Math.cos(i * Math.PI / 6), y + r(p) * Math.sin(i * Math.PI / 6)]); }
  const L = [], R = [];
  pts.forEach(([x, y, p], i) => {
    const [x0, y0] = pts[Math.max(0, i - 1)], [x1, y1] = pts[Math.min(pts.length - 1, i + 1)];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    L.push([x + nx * r(p), y + ny * r(p)]); R.push([x - nx * r(p), y - ny * r(p)]);
  });
  return [...L, ...R.reverse()];
}
function drawCanvas() {
  const c = $('#canvas'), ctx = c.getContext('2d'), dpr = devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = Draw.paper === 'light' ? '#fcfcfa' : '#121722';
  ctx.fillRect(0, 0, c.width, c.height);
  for (const s of [...Draw.strokes, ...(Draw.cur ? [Draw.cur] : [])]) {
    if (s.tool === 'highlighter') {
      ctx.globalAlpha = .35; ctx.strokeStyle = s.color; ctx.lineWidth = s.width * 3.5; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); s.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = s.color; ctx.beginPath();
      outline(s.points, s.width).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.fill();
    }
  }
}
function openDraw() {
  Draw.strokes = []; Draw.paper = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  Draw.ink = Draw.paper === 'dark' ? INKS[1] : INKS[0];
  $('#inks').innerHTML = INKS.map(c => `<button class="swatch${c === Draw.ink ? ' on' : ''}" data-ink="${c}" style="background:${c}"></button>`).join('');
  $('#draw').classList.add('on');
  const c = $('#canvas');
  c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio;
  drawCanvas();
}
const canvas = $('#canvas');
canvas.addEventListener('pointerdown', ev => {
  canvas.setPointerCapture(ev.pointerId);
  const p = ev.pressure || 0.5;
  if (Draw.tool === 'eraser') { Draw.cur = {erasing: true}; erase(ev.offsetX, ev.offsetY); return; }
  Draw.cur = {tool: Draw.tool, color: Draw.ink, width: Draw.width, points: [[ev.offsetX, ev.offsetY, p]]};
  drawCanvas();
});
canvas.addEventListener('pointermove', ev => {
  if (!Draw.cur) return;
  if (Draw.cur.erasing) { erase(ev.offsetX, ev.offsetY); return; }
  for (const e of ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev])
    Draw.cur.points.push([e.offsetX, e.offsetY, e.pressure || 0.5]);
  drawCanvas();
});
canvas.addEventListener('pointerup', () => {
  if (Draw.cur && !Draw.cur.erasing) {
    Draw.cur.points = Draw.cur.points.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]);
    Draw.strokes.push(Draw.cur);
  }
  Draw.cur = null; drawCanvas();
});
function erase(x, y) {
  const before = Draw.strokes.length;
  Draw.strokes = Draw.strokes.filter(s => !s.points.some(([px, py]) => Math.hypot(px - x, py - y) < Math.max(14, s.width)));
  if (before !== Draw.strokes.length) drawCanvas();
}
function drawingSVG() {
  const xs = Draw.strokes.flatMap(s => s.points.map(p => p[0])), ys = Draw.strokes.flatMap(s => s.points.map(p => p[1]));
  const x0 = Math.max(0, Math.min(...xs) - 30), y0 = Math.max(0, Math.min(...ys) - 30);
  const w = Math.max(200, Math.max(...xs) + 30 - x0), h = Math.max(120, Math.max(...ys) + 30 - y0);
  const bg = Draw.paper === 'light' ? '#fcfcfa' : '#121722';
  const paths = Draw.strokes.map(s => s.tool === 'highlighter'
    ? `<path d="M${s.points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L')}" fill="none" stroke="${s.color}" stroke-opacity="0.35" stroke-width="${(s.width * 3.5).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M${outline(s.points, s.width).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L')} Z" fill="${s.color}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}">
<metadata id="mk-drawing">${esc(JSON.stringify({strokes: Draw.strokes, paper: Draw.paper, pattern: 'plain'}))}</metadata>
<rect x="${x0.toFixed(0)}" y="${y0.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="14" fill="${bg}"/>
${paths.join('\n')}
</svg>`;
}
$('#drawbar').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.tool) { Draw.tool = b.dataset.tool; document.querySelectorAll('.tool').forEach(t => t.classList.toggle('on', t === b)); }
  if (b.dataset.ink) { Draw.ink = b.dataset.ink; if (Draw.tool === 'eraser') Draw.tool = 'pen'; document.querySelectorAll('#inks .swatch').forEach(s => s.classList.toggle('on', s === b)); }
});
$('#drawUndo').onclick = () => { Draw.strokes.pop(); drawCanvas(); };
$('#drawCancel').onclick = () => $('#draw').classList.remove('on');
$('#drawDone').onclick = async () => {
  $('#draw').classList.remove('on');
  if (!Draw.strokes.length) return;
  await addImage(new Blob([drawingSVG()], {type: 'image/svg+xml'}), 'Drawing');
};

// ---------- sheets and pickers ----------
function openSheet(id) {
  document.getElementById(id).classList.add('on');
  if (id === 'settings') {
    $('#pairLink').value = '';
    $('#pairState').textContent = S.key ? `Paired with ${S.server}` : 'Not paired yet';
  }
  if (id === 'more' && S.current) {
    document.querySelector('[data-more=pin] span').textContent = S.pinned.includes(S.current) ? 'Unpin' : 'Pin';
    $('#colorRow').innerHTML = ['', ...COLORS].map(c => `<button class="swatch" data-color="${c}" style="background:${c || 'transparent'}">${c ? '' : '✕'}</button>`).join('');
  }
}
document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', ev => { if (ev.target === s) s.classList.remove('on'); }));
function picker(title, items, onPick, onCreate) {
  $('#pickerTitle').textContent = title;
  const input = $('#pickerInput'); input.value = '';
  const fill = () => {
    const q = input.value.trim().toLowerCase();
    const list = items.filter(i => i.toLowerCase().includes(q)).slice(0, 50);
    if (q && onCreate && !list.some(i => i.toLowerCase() === q)) list.push(`➕ ${input.value.trim()}`);
    $('#pickerList').innerHTML = list.map(i => `<button class="row" data-pick="${esc(i)}">${esc(i)}</button>`).join('');
  };
  input.oninput = fill; fill();
  $('#pickerList').onclick = ev => {
    const b = ev.target.closest('[data-pick]'); if (!b) return;
    $('#picker').classList.remove('on');
    const v = b.dataset.pick;
    v.startsWith('➕ ') ? onCreate(v.slice(2)) : onPick(v);
  };
  openSheet('picker');
  setTimeout(() => input.focus(), 50);
}

// ---------- events ----------
$('#search').addEventListener('input', renderList);
$('#chips').addEventListener('click', ev => { const c = ev.target.closest('[data-filter]'); if (c) { S.filter = c.dataset.filter; renderList(); } });
$('#notes').addEventListener('click', ev => { const n = ev.target.closest('[data-path]'); if (n) openNote(n.dataset.path); });
$('#fab').onclick = async () => {
  const folder = S.filter.startsWith('f:') ? S.filter.slice(2) : '';
  const text = S.filter.startsWith('t:') ? `\n\n#${S.filter.slice(2)}` : '';
  const path = uniquePath(folder, 'New note');
  await saveNote(path, text);
  openNote(path);
  setReading(false);
  $('#title').select();
};
$('#syncBtn').onclick = () => sync(false);
$('#settingsBtn').onclick = () => openSheet('settings');
$('#pairBtn').onclick = async () => {
  const link = $('#pairLink').value.trim(), m = link.match(/key=([\w-]+)/);
  if (!m) { toast('Paste the whole link from the laptop'); return; }
  if (!await pairChecked(link, m[1])) return;
  $('#settings').classList.remove('on');
  sync(false);
};
$('#forgetBtn').onclick = async () => { await pair('', ''); S.server = ''; toast('Disconnected'); $('#settings').classList.remove('on'); };
$('#backBtn').onclick = closeNote;
$('#modeBtn').onclick = async () => { await flush(); setReading(!S.reading); };
$('#moreBtn').onclick = () => openSheet('more');
$('#title').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); setReading(false); $('#text').focus(); } });
$('#title').addEventListener('blur', commitTitle);
$('#view').addEventListener('click', async ev => {
  const box = ev.target.closest('input[data-task]');
  if (box) {
    let n = -1;
    const text = $('#text').value.replace(/^(\s*[-*+] )\[( |x|X)\]/gm, (all, pre, mark) => (++n === +box.dataset.task ? pre + (mark === ' ' ? '[x]' : '[ ]') : all));
    $('#text').value = text; await flush(); renderView(); return;
  }
  const a = ev.target.closest('a[data-note]');
  if (a) {
    ev.preventDefault();
    const name = a.dataset.note.toLowerCase();
    const found = notes().find(n => stem(n.path).toLowerCase() === name || n.path.toLowerCase() === name);
    if (found) { await flush(); openNote(found.path); }
    else { const path = uniquePath('', a.dataset.note); await saveNote(path, ''); openNote(path); }
  }
});
$('#tools').addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  if (S.reading && !['photo', 'draw'].includes(b.dataset.act)) setReading(false);
  ({
    check: () => linePrefix('- [ ] '), bold: () => wrap('**', '**'), list: () => linePrefix('- '),
    heading: () => linePrefix('## '),
    link: () => picker('Link a note', notes().map(n => stem(n.path)), n => insertText(`[[${n}]]`), n => insertText(`[[${n}]]`)),
    photo: () => $('#photoInput').click(),
    draw: openDraw,
  })[b.dataset.act]();
});
$('#photoInput').onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) await addImage(f); if (S.reading) renderView(); };
$('#more').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b || !S.current) return;
  const act = b.dataset.more;
  if (b.dataset.color !== undefined) {
    // colours and pins are kept by the laptop; set them here for the list until the next sync
    if (b.dataset.color) S.colors[S.current] = b.dataset.color; else delete S.colors[S.current];
    await DB.setKV('colors', S.colors);
  } else if (act === 'pin') {
    S.pinned = S.pinned.includes(S.current) ? S.pinned.filter(p => p !== S.current) : [S.current, ...S.pinned];
    await DB.setKV('pinned', S.pinned);
  } else if (act === 'share') {
    await flush(); setReading(true); $('#more').classList.remove('on');
    setTimeout(() => window.print(), 300);
    return;
  } else if (act === 'move') {
    $('#more').classList.remove('on');
    const folders = [...new Set(notes().map(n => folderOf(n.path)).filter(Boolean))];
    const move = async folder => {
      await flush();
      const old = S.files.get(S.current), path = uniquePath(folder === 'Vault root' ? '' : folder, stem(S.current));
      await saveNote(path, old.text); await removeFile(S.current); openNote(path, true);
    };
    picker('Move to folder', ['Vault root', ...folders], move, move);
    return;
  } else if (act === 'delete') {
    const path = S.current;
    S.current = null;
    await removeFile(path);
    $('#more').classList.remove('on');
    $('#editor').classList.add('hidden'); $('#list').classList.remove('behind');
    renderList(); toast('Deleted (it goes to the laptop\'s trash)'); sync();
    return;
  }
  $('#more').classList.remove('on');
  renderList();
});

// Sync whenever it makes sense: coming back to the app, back online, every 30 s.
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); else flush(); });
addEventListener('online', () => sync());
setInterval(() => { if (!document.hidden) sync(); }, 30000);
// Android back button / swipe: close the note instead of leaving.
addEventListener('popstate', () => { if (S.current) closeNote(); });
const _open = openNote;
openNote = (path, keep) => { if (!S.current) history.pushState({note: path}, ''); _open(path, keep); };  // eslint-disable-line no-func-assign

load();
