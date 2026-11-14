'use strict';
const DEF = { owner: 'edzesterv2026-web', repo: 'edzesnaplo-adatok' };
const REST = ['Pihenő', 'Utazás'];
const NAPNEV = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const HONAP = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

let cfg = ls.get('cfg', null);
let plan = ls.get('plan', null);
let log = ls.get('log', {});
let garmin = ls.get('garmin', { hetek: {}, edzesek: {} });
let pend = ls.get('pend', {});
let view = 'ma';
let weekIdx = null;
let openId = null;
let flushTimer = null;

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtD = s => { const d = parseD(s); return HONAP[d.getMonth()] + ' ' + d.getDate() + '.'; };
const entry = id => Object.assign({}, log[id] || {}, pend[id] || {});
const isRest = it => REST.includes(it.sport);

function setSync(t) { $('#sync').textContent = t; }

/* ---------- GitHub ---------- */
function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: opts.method || 'GET',
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
async function ghGet(path) {
  const j = await gh(path + '?t=' + Date.now());
  return { data: JSON.parse(b64dec(j.content)), sha: j.sha };
}

async function loadRemote() {
  if (!navigator.onLine) { setSync('offline'); return; }
  setSync('frissítés…');
  try {
    const [p, l, g] = await Promise.all([ghGet('plan.json'), ghGet('log.json'), ghGet('garmin.json').catch(() => null)]);
    plan = p.data; ls.set('plan', plan);
    log = l.data || {}; ls.set('log', log);
    if (g) { garmin = g.data; ls.set('garmin', garmin); }
    setSync(Object.keys(pend).length ? 'mentésre vár' : '✓');
    render();
    if (Object.keys(pend).length) flush();
  } catch (e) {
    setSync(e.status === 401 || e.status === 404 ? 'hibás kulcs?' : 'nincs kapcsolat');
    if (!plan) renderSetup(e.status === 401 || e.status === 404 ? 'A kulcs vagy a tároló neve nem jó, vagy a kulcs lejárt.' : 'Nem sikerült elérni a GitHubot.');
  }
}

function change(id, patch) {
  pend[id] = Object.assign({}, pend[id] || {}, patch);
  ls.set('pend', pend);
  setSync('mentésre vár');
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 1200);
}

async function flush(retry = 0) {
  if (!Object.keys(pend).length || !navigator.onLine || !cfg) return;
  setSync('mentés…');
  const sending = JSON.parse(JSON.stringify(pend));
  try {
    const cur = await ghGet('log.json');
    const merged = cur.data || {};
    for (const id in sending) merged[id] = Object.assign({}, merged[id] || {}, sending[id]);
    await gh('log.json', { method: 'PUT', body: { message: 'Napló frissítése', content: b64enc(JSON.stringify(merged, null, 1)), sha: cur.sha } });
    log = merged; ls.set('log', log);
    for (const id in sending) if (JSON.stringify(pend[id]) === JSON.stringify(sending[id])) delete pend[id];
    ls.set('pend', pend);
    setSync(Object.keys(pend).length ? 'mentésre vár' : '✓ mentve');
    if (Object.keys(pend).length) flushTimer = setTimeout(flush, 800);
  } catch (e) {
    if ((e.status === 409 || e.status === 422) && retry < 3) return flush(retry + 1);
    setSync('mentés később');
  }
}
window.addEventListener('online', () => { flush(); loadRemote(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cfg) loadRemote(); else flush(); });

/* ---------- plan helpers ---------- */
function weeks() { return plan.hetek; }
function itemsOfWeek(h) { return plan.edzesek.filter(i => i.het === h); }
function currentWeekIdx() {
  const t = todayStr();
  const w = weeks();
  for (let k = 0; k < w.length; k++) {
    const its = itemsOfWeek(w[k].het);
    const end = w[k].het === 0 ? '2026-11-15' : its[its.length - 1].datum;
    if (t <= end) return k;
  }
  return w.length - 1;
}
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function groupByDay(its) {
  const m = new Map();
  its.forEach(i => { if (!m.has(i.datum)) m.set(i.datum, []); m.get(i.datum).push(i); });
  return m;
}
function weekStats(h) {
  const its = itemsOfWeek(h).filter(i => !isRest(i));
  const done = its.filter(i => entry(i.id).k).length;
  return { done, total: its.length };
}

/* ---------- rendering ---------- */
const LABEL = s => s === 'Bringa' ? 'Bicikli' : s;
const bike = t => t.replace(/Bringa/g, 'Bicikli').replace(/bringa/g, 'bicikli');
function shortName(i) {
  let t = i.edzes;
  const pre = { Brick: /^Bringa:\s+/, Bringa: /^Bringa:?\s+/, Futás: /^Futás:?\s+/, Úszás: /^Úszás:?\s+/ }[i.sport];
  if (pre && pre.test(t)) t = t.replace(pre, '');
  if (i.sport === 'Kondi') { const m = t.match(/^Kondi\s*\((.*)\)$/); if (m) t = m[1]; }
  return bike(t.charAt(0).toUpperCase() + t.slice(1));
}
function itemHTML(i) {
  const e = entry(i.id);
  const rest = isRest(i);
  const g = garmin.edzesek && garmin.edzesek[i.id];
  const cls = ['it', e.k ? 'done' : '', rest ? 'rest' : '', openId === i.id ? 'open' : ''].join(' ');
  const feel = [1, 2, 3, 4, 5].map(n => `<button data-feel="${n}" class="${e.e === n ? 'on' : ''}">${n}</button>`).join('');
  return `<div class="${cls}" data-id="${i.id}">
    <button class="chk" data-chk="${i.id}" aria-label="kész">${e.k ? '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.5 7.4l2.9 2.9 6-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</button>
    <div class="body" data-tog="${i.id}">
      ${rest ? '' : `<div class="tag" style="--c:var(--${i.sport})">${esc(LABEL(i.sport))}</div>`}<div class="t">${esc(rest ? i.edzes : shortName(i))}</div>
      ${e.m && openId !== i.id ? `<div class="note">„${esc(e.m)}”</div>` : ''}
      ${g ? `<div class="gm">⌚ ${esc(g)}</div>` : ''}
      <div class="how">${esc(i.hogyan)}</div>
      ${rest ? '' : `<div class="extra">
        <div class="feel">Hogy ment? ${feel}<span style="margin-left:auto;font-size:12px">1 nehéz · 5 könnyű</span></div>
        <textarea data-note="${i.id}" placeholder="Megjegyzés (pl. térd, pulzus, idő)">${esc(e.m || '')}</textarea>
      </div>`}
    </div></div>`;
}
function dayHTML(datum, its, label) {
  const t = todayStr();
  const d = parseD(datum);
  const title = label || (fmtD(datum) + ' – ' + NAPNEV[d.getDay()]);
  return `<div class="card day ${datum === t ? 'today' : ''}"><h3>${esc(title)}</h3>${its.map(itemHTML).join('')}</div>`;
}

function renderMa() {
  const t = todayStr();
  const its = plan.edzesek;
  let html = '';
  const race = plan.verseny;
  const days = Math.round((parseD(race) - parseD(t)) / 864e5);
  const today = its.filter(i => i.datum === t);
  if (today.length) html += dayHTML(t, today, fmtD(t) + ' – ' + NAPNEV[parseD(t).getDay()] + ' · ma');
  else if (t === '2026-11-15') html += dayHTML('2026-11-14', its.filter(i => i.het === 0), fmtD(t) + ' – vasárnap · ma (ha szombaton nem volt meg)');
  else html += `<div class="card"><h3 style="margin:0;font-size:14px;color:var(--mute)">MA</h3><div class="muted">Ma nincs edzés a tervben.</div></div>`;
  // következő napok
  const next = [...groupByDay(its.filter(i => i.datum > t)).entries()].slice(0, 2);
  next.forEach(([d, a]) => html += dayHTML(d, a));
  // lemaradt edzések az elmúlt 7 napból
  const missed = its.filter(i => !isRest(i) && i.datum < t && i.datum >= addDays(t, -7) && !entry(i.id).k);
  if (missed.length) html += `<div class="card day"><h3>Elmúlt 7 nap – nincs kipipálva</h3>${missed.map(itemHTML).join('')}</div>`;
  $('#main').innerHTML = html;
}

function renderHet() {
  const w = weeks();
  if (weekIdx == null) weekIdx = currentWeekIdx();
  const wk = w[weekIdx];
  const st = weekStats(wk.het);
  const parts = wk.cim.split(' · ');
  let html = `<div class="wkhead"><button data-wk="-1" ${weekIdx === 0 ? 'disabled' : ''}>‹</button>
    <div class="ttl">${esc(parts[0])}<small>${esc(parts.slice(1).join(' · '))}</small></div>
    <button data-wk="1" ${weekIdx === w.length - 1 ? 'disabled' : ''}>›</button></div>`;
  html += `<div class="bar"><i style="width:${st.total ? 100 * st.done / st.total : 0}%"></i></div>
    <div class="muted" style="margin:0 4px 10px">${st.done} / ${st.total} edzés kész</div>`;
  if (wk.megj) html += `<div class="wmegj">${esc(wk.megj)}</div>`;
  const gw = garmin.hetek && garmin.hetek[wk.het];
  if (gw) html += `<div class="card"><h3 style="margin:0 0 4px;font-size:14px;color:var(--mute)">⌚ GARMIN-ÖSSZESÍTŐ</h3><div style="font-size:14px;white-space:pre-line">${esc(gw)}</div></div>`;
  const its = itemsOfWeek(wk.het);
  if (wk.het === 0) html += dayHTML(its[0].datum, its, 'szombat vagy vasárnap, nov. 14–15.');
  else groupByDay(its).forEach((a, d) => html += dayHTML(d, a));
  $('#main').innerHTML = html;
}

function renderHalad() {
  const t = todayStr();
  const all = plan.edzesek.filter(i => !isRest(i));
  const past = all.filter(i => i.datum <= t);
  const done = all.filter(i => entry(i.id).k);
  const days = Math.max(0, Math.round((parseD(plan.verseny) - parseD(t)) / 864e5));
  let html = `<div class="card" style="text-align:center"><div class="big">${days}</div><div class="muted">nap a versenyig (máj. 23.)</div></div>`;
  html += `<div class="card"><b>Eddig</b><div class="bar"><i style="width:${past.length ? 100 * done.filter(i => i.datum <= t).length / past.length : 0}%"></i></div>
    <div class="muted">${done.filter(i => i.datum <= t).length} / ${past.length} esedékes edzés kész · összesen ${done.length} / ${all.length}</div></div>`;
  const sports = ['Úszás', 'Bringa', 'Futás', 'Brick', 'Kondi'];
  html += `<div class="card"><b>Sportáganként (eddig esedékes)</b><table>${sports.map(s => {
    const p = past.filter(i => i.sport === s), d = p.filter(i => entry(i.id).k);
    return `<tr><td><span class="tag" style="--c:var(--${s})">${LABEL(s)}</span></td><td>${d.length} / ${p.length}</td></tr>`;
  }).join('')}</table></div>`;
  html += `<div class="card"><b>Hetek</b>${weeks().map((w, k) => {
    const st = weekStats(w.het);
    return `<div class="wkrow" data-gowk="${k}"><span>${esc(w.cim.split(' · ')[0])}</span><div class="bar"><i style="width:${st.total ? 100 * st.done / st.total : 0}%"></i></div><span class="muted">${st.done}/${st.total}</span></div>`;
  }).join('')}</div>`;
  $('#main').innerHTML = html;
}

function renderInfo() {
  let html = `<div class="card"><b>Fogalmak</b><table>${plan.fogalmak.map(f => `<tr><th style="width:38%">${esc(f.f)}</th><td>${esc(f.j)}</td></tr>`).join('')}</table></div>`;
  html += `<div class="card"><b>Beállítások</b><div class="muted" style="margin:6px 0">Terv frissítve: ${esc(plan.frissitve || '')}${garmin.frissitve ? ' · Garmin-ellenőrzés: ' + esc(garmin.frissitve) : ''}</div>
    <button class="btn ghost" id="reload">Frissítés most</button> <button class="btn ghost" id="reset">Kulcs cseréje</button></div>`;
  $('#main').innerHTML = html;
  $('#reload').onclick = () => loadRemote();
  $('#reset').onclick = () => renderSetup();
}

function renderSetup(msg) {
  $('#nav').style.display = 'none';
  const c = cfg || DEF;
  $('#main').innerHTML = `<div class="card"><b>Első beállítás</b>
    <p class="muted">Ide kell egyszer beírnod a GitHubon létrehozott hozzáférési kulcsot. Ez csak ezen a telefonon tárolódik.</p>
    ${msg ? `<p style="color:#c0392b">${esc(msg)}</p>` : ''}
    <label class="muted">GitHub-felhasználónév</label><input type="text" id="o" value="${esc(c.owner)}" autocapitalize="off" autocorrect="off">
    <label class="muted">Adattároló neve</label><input type="text" id="r" value="${esc(c.repo)}" autocapitalize="off" autocorrect="off">
    <label class="muted">Hozzáférési kulcs (github_pat_…)</label><input type="password" id="k" value="" autocapitalize="off" autocorrect="off">
    <button class="btn" id="save">Mentés és indítás</button></div>`;
  $('#save').onclick = () => {
    const k = $('#k').value.trim() || (cfg && cfg.token);
    if (!k) return;
    cfg = { owner: $('#o').value.trim(), repo: $('#r').value.trim(), token: k };
    ls.set('cfg', cfg);
    $('#nav').style.display = '';
    plan ? render() : ($('#main').innerHTML = '<div class="muted" style="padding:20px">Betöltés…</div>');
    loadRemote();
  };
}

function render() {
  if (!plan) return;
  const dl = Math.round((parseD(plan.verseny) - parseD(todayStr())) / 864e5);
  $('#sub').innerHTML = dl > 0 ? `Még <b>${dl}</b> nap a versenyig` : dl === 0 ? '<b>Ma van a verseny!</b>' : 'IRONMAN 70.3 St. Pölten';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  const y = window.scrollY;
  ({ ma: renderMa, het: renderHet, halad: renderHalad, info: renderInfo })[view]();
  if (y) window.scrollTo(0, y);
}

/* ---------- events ---------- */
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  view = b.dataset.v; if (view === 'het') weekIdx = currentWeekIdx();
  openId = null; window.scrollTo(0, 0); render();
});
$('#main').addEventListener('click', e => {
  const chk = e.target.closest('[data-chk]');
  if (chk) {
    const id = chk.dataset.chk, cur = entry(id);
    change(id, cur.k ? { k: false } : { k: true, t: new Date().toISOString() });
    if (!cur.k) openId = id;
    render(); return;
  }
  const f = e.target.closest('[data-feel]');
  if (f) { const id = f.closest('.it').dataset.id; change(id, { e: Number(f.dataset.feel) }); render(); return; }
  if (e.target.closest('textarea')) return;
  const tog = e.target.closest('[data-tog]');
  if (tog) { openId = openId === tog.dataset.tog ? null : tog.dataset.tog; render(); return; }
  const wk = e.target.closest('[data-wk]');
  if (wk) { weekIdx += Number(wk.dataset.wk); openId = null; window.scrollTo(0, 0); render(); return; }
  const go = e.target.closest('[data-gowk]');
  if (go) { view = 'het'; weekIdx = Number(go.dataset.gowk); window.scrollTo(0, 0); render(); }
});
$('#main').addEventListener('input', e => {
  if (e.target.dataset.note) {
    const id = e.target.dataset.note;
    pend[id] = Object.assign({}, pend[id] || {}, { m: e.target.value });
    ls.set('pend', pend);
    setSync('mentésre vár');
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 2000);
  }
});

/* ---------- start ---------- */
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); });
}
if (!cfg || !cfg.token) renderSetup();
else { if (plan) render(); else $('#main').innerHTML = '<div class="muted" style="padding:20px">Betöltés…</div>'; loadRemote(); }
