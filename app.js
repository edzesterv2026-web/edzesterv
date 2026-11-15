'use strict';
const APP_VERSION = '20';
async function checkUpdate() {
  try { const v = (await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }).then(r => r.text())).trim(); if (v && v !== APP_VERSION && sessionStorage.getItem('reloadedFor') !== v) { sessionStorage.setItem('reloadedFor', v); location.reload(); } } catch (e) {}
}
checkUpdate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
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
let uszi = ls.get('uszi', null);
let uDay = null;
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
    const [p, l, g, u] = await Promise.all([ghGet('plan.json'), ghGet('log.json'), ghGet('garmin.json').catch(() => null), ghGet('uszodak.json').catch(() => null)]);
    plan = p.data; ls.set('plan', plan);
    log = l.data || {}; ls.set('log', log);
    if (g) { garmin = g.data; ls.set('garmin', garmin); }
    if (u) { uszi = u.data; ls.set('uszi', uszi); }
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
const eff = i => entry(i.id).d || i.datum;
const ORD = {};
function weekRange(h) { if (h === 0) return ['2026-11-14', '2026-11-15']; const mon = addDays('2026-11-16', 7 * (h - 1)); return [mon, addDays(mon, 6)]; }
function sortEff(its) { return its.slice().sort((x, y) => eff(x) < eff(y) ? -1 : eff(x) > eff(y) ? 1 : ORD[x.id] - ORD[y.id]); }
function extras() {
  const keys = new Set(Object.keys(log).concat(Object.keys(pend)).filter(k => k.startsWith('x-')));
  const out = [];
  keys.forEach(k => { const e = entry(k); if (!e.del && e.datum) { out.push({ id: k, datum: e.datum, sport: e.sport || 'Egyéb', edzes: e.edzes || 'Edzés', hogyan: e.hogyan || '', perc: e.perc, extra: true }); ORD[k] = 1e6 + Number(k.slice(2)) / 1e6; } });
  return out;
}
function allItems() { return plan.edzesek.concat(extras()); }
function itemsOfWeek(h) { const [s, e] = weekRange(h); return sortEff(allItems().filter(i => { const d = eff(i); return d >= s && d <= e; })); }
function currentWeekIdx() {
  const t = todayStr();
  const w = weeks();
  for (let k = 0; k < w.length; k++) {
    const end = weekRange(w[k].het)[1];
    if (t <= end) return k;
  }
  return w.length - 1;
}
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function groupByDay(its) {
  const m = new Map();
  sortEff(its).forEach(i => { const d = eff(i); if (!m.has(d)) m.set(d, []); m.get(d).push(i); });
  return m;
}
const FALLBACK = { Kondi: 40, Úszás: 45, Futás: 40, Bringa: 60, Brick: 75, Egyéb: 30, Verseny: 330 };
function parseMins(t, standaloneOnly) {
  let sum = 0, found = false;
  t = t.replace(/\d+:\d{2}(?:\s*[–-]\s*\d+:\d{2})?\s*\/\s*km/g, ' ');
  t = t.replace(/(\d+):(\d{2})(?:\s*[–-]\s*(\d+):(\d{2}))?(?!\s*\/\s*km)(?![\d])/g, (m, h, mm, h2, mm2) => {
    let v = (+h) * 60 + (+mm); if (h2) v = (v + (+h2) * 60 + (+mm2)) / 2; sum += v; found = true; return ' ';
  });
  if (!standaloneOnly) {
    let lastN = 0;
    t = t.replace(/(\d+)×(\d+)'/g, (m, n, x) => { sum += n * x; lastN = +n; found = true; return ' '; });
    t = t.replace(/(\d+)×(\d+)\s*m\b/g, (m, n, x) => { sum += n * x / 1000 * 5.5; lastN = +n; found = true; return ' '; });
    t = t.replace(/(\d+)×1\s*km/g, (m, n) => { sum += n * 5.5; lastN = +n; found = true; return ' '; });
    t = t.replace(/közte (\d+)(?:[–-](\d+))?\s*(?:'|mp)/g, (m, x, y, off, str) => { const v = y ? (+x + +y) / 2 : +x; if (!/mp$/.test(m)) sum += Math.max(0, lastN - 1) * v; else sum += Math.max(0, lastN - 1) * v / 60; return ' '; });
  } else {
    t = t.replace(/\d+×\d+'/g, ' ');
  }
  t.replace(/(?<![×\d])(\d+)(?:\s*[–-]\s*(\d+))?'/g, (m, x, y) => { sum += y ? (+x + +y) / 2 : +x; found = true; return ''; });
  return found ? sum : null;
}
function planMins(i) {
  if (i.perc) return +i.perc;
  if (isRest(i) || i.sport === 'Utazás') return 0;
  if (i.sport === 'Kondi') return 40;
  let v = parseMins(i.edzes, true);
  if (v == null && /×/.test(i.edzes)) v = parseMins(i.hogyan, false);
  if (v == null && /FTP-teszt/.test(i.edzes)) v = 60;
  if (/Versenyszimul/.test(i.edzes)) v = 225;
  return v == null ? (FALLBACK[i.sport] || 30) : v;
}
function gmOf(id) { const g = garmin.edzesek && garmin.edzesek[id]; if (!g) return null; return typeof g === 'string' ? { s: g } : g; }
function doneMins(i) { if (!entry(i.id).k) return 0; const g = gmOf(i.id); return g && g.perc ? +g.perc : planMins(i); }
function gmExtras(d) { return (garmin.extra || []).filter(x => x.datum === d); }
const hrs = m => (Math.round(m / 6) / 10).toString().replace('.', ',');
function weekHours(h) {
  const its = itemsOfWeek(h); const [s, e] = weekRange(h);
  let plan_ = 0, done = 0;
  its.forEach(i => { if (!i.extra) plan_ += planMins(i); done += doneMins(i); });
  (garmin.extra || []).forEach(x => { if (x.datum >= s && x.datum <= e && x.perc) done += +x.perc; });
  return { plan: plan_, done };
}
function weekStats(h) {
  const its = itemsOfWeek(h).filter(i => !isRest(i));
  const done = its.filter(i => entry(i.id).k).length;
  return { done, total: its.length };
}

/* ---------- rendering ---------- */
const beall = () => entry('_beall');
const PULZ = { Z1: '150 alatt', Z2: '150–158', 'tempó': '159–166', 'küszöb': '167–176' };
function watts(p) { const f = +beall().ftp; return f ? Math.round(f * p / 100) : null; }
function augFTP(t) {
  if (!+beall().ftp) return t;
  return t.replace(/(\d+)(?:\s*[–-]\s*(\d+))?\s*% FTP/g, (m, x, y) => y ? `${m} (${watts(+x)}–${watts(+y)} W)` : `${m} (${watts(+x)} W)`);
}
function augTitle(i, t) {
  if (i.sport === 'Futás' || i.sport === 'Brick') t = t.replace(/\bZ([12])\b/g, (m) => `${m} (${PULZ[m]})`);
  if (i.sport === 'Bringa' && +beall().ftp) t = t.replace(/\bZ2\b/, `Z2 (${watts(56)}–${watts(75)} W)`);
  return augFTP(t);
}
const LABEL = s => s === 'Bringa' ? 'Bicikli' : s;
const bike = t => t.replace(/Bringa/g, 'Bicikli').replace(/bringa/g, 'bicikli');
function shortName(i) {
  if (i.extra) return bike(i.edzes);
  let t = i.edzes;
  const pre = { Brick: /^Bringa:\s+/, Bringa: /^Bringa:?\s+/, Futás: /^Futás:?\s+/, Úszás: /^Úszás:?\s+/ }[i.sport];
  if (pre && pre.test(t)) t = t.replace(pre, '');
  if (i.sport === 'Kondi') { const m = t.match(/^Kondi\s*\((.*)\)$/); if (m) t = m[1]; }
  return bike(t.charAt(0).toUpperCase() + t.slice(1));
}
function moveHTML(i) {
  const cur = eff(i);
  const d = parseD(cur), mon = addDays(cur, -((d.getDay() + 6) % 7));
  let opts = '';
  for (let k = 0; k < 7; k++) { const x = addDays(mon, k); opts += `<option value="${x}" ${x === cur ? 'selected' : ''}>${fmtD(x)} – ${NAPNEV[parseD(x).getDay()]}</option>`; }
  if (cur !== i.datum && (i.datum < mon || i.datum > addDays(mon, 6))) opts += `<option value="${i.datum}">${fmtD(i.datum)} (eredeti nap)</option>`;
  return `<div class="move">Nap: <select data-move="${i.id}">${opts}</select>${cur !== i.datum ? ` <button data-reset="${i.id}">eredeti: ${fmtD(i.datum)}</button>` : ''}</div>`;
}
function itemHTML(i) {
  const e = entry(i.id);
  const rest = isRest(i);
  const g = gmOf(i.id);
  const moved = eff(i) !== i.datum;
  const cls = ['it', e.k ? 'done' : '', rest ? 'rest' : '', openId === i.id ? 'open' : ''].join(' ');
  const feel = [1, 2, 3, 4, 5].map(n => `<button data-feel="${n}" class="${e.e === n ? 'on' : ''}">${n}</button>`).join('');
  return `<div class="${cls}" data-id="${i.id}">
    <button class="chk" data-chk="${i.id}" aria-label="kész">${e.k ? '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2.5 7.4l2.9 2.9 6-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</button>
    <div class="body" data-tog="${i.id}">
      ${rest ? '' : `<div class="tag" style="--c:var(--${i.sport})">${esc(LABEL(i.sport))}</div>`}<div class="t">${esc(rest ? i.edzes : augTitle(i, shortName(i)))}</div>
      ${moved && openId !== i.id ? `<div class="note">áthelyezve (eredetileg ${fmtD(i.datum)})</div>` : ''}
      ${e.m && openId !== i.id ? `<div class="note">„${esc(e.m)}”</div>` : ''}
      ${g ? `<div class="gm">⌚ ${esc(g.s)}</div>` : ''}
      <div class="how">${esc(augFTP(i.hogyan))}</div>
      ${rest ? `<div class="extra">${moveHTML(i)}</div>` : `<div class="extra">
        <div class="feel">Hogy ment? ${feel}<span style="margin-left:auto;font-size:12px">1 nehéz · 5 könnyű</span></div>
        <div class="feel knee">Térd: ${['rendben', 'érzem', 'fáj'].map((l, n) => `<button data-knee="${n}" class="${e.tr === n ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${moveHTML(i)}
        <textarea data-note="${i.id}" placeholder="Megjegyzés (pl. pulzus, idő, érzés)">${esc(e.m || '')}</textarea>
        ${i.extra ? `<button class="del" data-del="${i.id}">Edzés törlése</button>` : ''}
      </div>`}
    </div></div>`;
}
function dayHTML(datum, its, label) {
  const t = todayStr();
  const d = parseD(datum);
  const title = label || (fmtD(datum) + ' – ' + NAPNEV[d.getDay()]);
  if (its.some(i => !isRest(i))) its = its.filter(i => i.sport !== 'Pihenő' || entry(i.id).d);
  const body = its.length ? its.map(itemHTML).join('') : '<div class="it rest empty"><button class="chk"></button><div class="body"><div class="t">Nincs edzés</div></div></div>';
  const gx = gmExtras(datum).map(x => `<div class="gmx">⌚ Terven kívül (Garmin): ${esc(x.s)}</div>`).join('');
  return `<div class="card day ${datum === t ? 'today' : ''}" data-date="${datum}"><h3>${esc(title)}</h3>${body}${gx}</div>`;
}

let addOpen = false;
function addHTML(defDate) {
  if (!addOpen) return `<div class="addwrap"><button id="addbtn" aria-label="Edzés hozzáadása"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>`;
  const d = parseD(defDate), mon = addDays(defDate, -((d.getDay() + 6) % 7));
  let opts = '';
  for (let k = -7; k < 7; k++) { const x = addDays(mon, k); if (x < '2026-11-14') continue; opts += `<option value="${x}" ${x === defDate ? 'selected' : ''}>${fmtD(x)} – ${NAPNEV[parseD(x).getDay()]}</option>`; }
  const sp = ['Úszás', 'Bringa', 'Futás', 'Brick', 'Kondi', 'Egyéb'].map(s => `<option value="${s}">${LABEL(s)}</option>`).join('');
  return `<div class="card addform"><h3>Edzés hozzáadása</h3>
    <label>Nap<select id="ad-d">${opts}</select></label>
    <label>Sportág<select id="ad-s">${sp}</select></label>
    <label>Mit csináltál?<input type="text" id="ad-n" placeholder="pl. úszás 1500 m"></label>
    <label>Időtartam (perc)<input type="number" id="ad-p" inputmode="numeric" placeholder="45"></label>
    <label class="row"><input type="checkbox" id="ad-k" checked> Már megcsináltam</label>
    <div class="row"><button class="btn" id="ad-save">Mentés</button><button class="btn ghost" id="ad-cancel">Mégse</button></div></div>`;
}
function renderMa() {
  const t = todayStr();
  const its = allItems();
  let html = '';
  const race = plan.verseny;
  const days = Math.round((parseD(race) - parseD(t)) / 864e5);
  const today = sortEff(its.filter(i => eff(i) === t));
  if (today.length) html += dayHTML(t, today, fmtD(t) + ' – ' + NAPNEV[parseD(t).getDay()] + ' · ma');
  else if (t === '2026-11-15') html += dayHTML('2026-11-14', its.filter(i => i.het === 0), fmtD(t) + ' – vasárnap · ma (ha szombaton nem volt meg)');
  else html += `<div class="card"><h3 style="margin:0;font-size:14px;color:var(--mute)">MA</h3><div class="muted">Ma nincs edzés a tervben.</div></div>`;
  // következő napok
  const next = [...groupByDay(its.filter(i => eff(i) > t)).entries()].sort((x, y) => x[0] < y[0] ? -1 : 1).slice(0, 2);
  next.forEach(([d, a]) => html += dayHTML(d, a));
  // lemaradt edzések az elmúlt 7 napból
  const missed = sortEff(its.filter(i => !isRest(i) && eff(i) < t && eff(i) >= addDays(t, -7) && !entry(i.id).k));
  if (missed.length) html += `<div class="card day"><h3>Elmúlt 7 nap – nincs kipipálva</h3>${missed.map(itemHTML).join('')}</div>`;
  html += addHTML(t);
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
    <div class="muted" style="margin:0 4px 10px">${st.done} / ${st.total} edzés kész · ${hrs(weekHours(wk.het).done)} / kb. ${hrs(weekHours(wk.het).plan)} óra</div>`;
  if (wk.megj) html += `<div class="wmegj">${esc(wk.megj)}</div>`;
  const gw = garmin.hetek && garmin.hetek[wk.het];
  if (gw) html += `<div class="card"><h3 style="margin:0 0 4px;font-size:14px;color:var(--mute)">⌚ GARMIN-ÖSSZESÍTŐ</h3><div style="font-size:14px;white-space:pre-line">${esc(gw)}</div></div>`;
  const its = itemsOfWeek(wk.het);
  html += `<div class="muted hint">Tipp: tartsd az ujjad egy edzésen, és húzd át másik napra.</div>`;
  if (wk.het === 0) html += dayHTML('2026-11-14', its, 'nov. 14–15. – szombat vagy vasárnap');
  else { const g = groupByDay(its), mon = weekRange(wk.het)[0]; for (let k = 0; k < 7; k++) { const d = addDays(mon, k); html += dayHTML(d, g.get(d) || []); } }
  html += addHTML(weekRange(wk.het)[0] <= todayStr() && todayStr() <= weekRange(wk.het)[1] ? todayStr() : weekRange(wk.het)[0]);
  $('#main').innerHTML = html;
}

function renderHalad() {
  const t = todayStr();
  const all = allItems().filter(i => !isRest(i));
  const past = all.filter(i => eff(i) <= t);
  const done = all.filter(i => entry(i.id).k);
  const days = Math.max(0, Math.round((parseD(plan.verseny) - parseD(t)) / 864e5));
  let html = '';
  html += `<div class="card"><b>Eddig</b><div class="bar"><i style="width:${past.length ? 100 * done.filter(i => eff(i) <= t).length / past.length : 0}%"></i></div>
    <div class="muted">${done.filter(i => eff(i) <= t).length} / ${past.length} esedékes edzés kész · összesen ${done.length} / ${all.length}</div></div>`;
  const sports = ['Úszás', 'Bringa', 'Futás', 'Brick', 'Kondi'];
  html += `<div class="card"><b>Sportáganként (eddig esedékes)</b><table>${sports.map(s => {
    const p = past.filter(i => i.sport === s), d = p.filter(i => entry(i.id).k);
    return `<tr><td><span class="tag" style="--c:var(--${s})">${LABEL(s)}</span></td><td>${d.length} / ${p.length}</td></tr>`;
  }).join('')}</table></div>`;
  const wh = weeks().map(w => weekHours(w.het)), maxH = Math.max(...wh.map(x => Math.max(x.plan, x.done)), 60);
  html += `<div class="card"><b>Heti edzésidő</b><div class="muted legend"><i class="lg p"></i>terv <i class="lg d"></i>teljesítve (óra)</div>${weeks().map((w, k) => {
    const x = wh[k];
    return `<div class="wkrow" data-gowk="${k}"><span class="wn">${w.het}. hét</span><div class="hb"><i class="p" style="width:${100 * x.plan / maxH}%"></i><i class="d" style="width:${100 * x.done / maxH}%"></i></div><span class="muted hv">${hrs(x.done)} / ${hrs(x.plan)}</span></div>`;
  }).join('')}</div>`;
  html += feelHTML();
  $('#main').innerHTML = html;
}

function feelHTML() {
  const items = allItems().filter(i => !isRest(i));
  const cw = currentWeekIdx();
  const ws = weeks().slice(0, cw + 1);
  const pts = ws.map(w => { const es = itemsOfWeek(w.het).map(i => entry(i.id)).filter(e => e.e); return es.length ? es.reduce((s, e) => s + e.e, 0) / es.length : null; });
  const kn = ws.map(w => itemsOfWeek(w.het).map(i => entry(i.id).tr || 0).reduce((m, v) => Math.max(m, v), 0));
  const W = 320, H = 130, n = Math.max(ws.length, 2), X = k => 20 + k * (W - 30) / (n - 1), Y = v => 12 + (5 - v) * (H - 40) / 4;
  let path = '', dots = '';
  pts.forEach((v, k) => { if (v != null) { path += (path ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(v).toFixed(1); dots += `<circle cx="${X(k)}" cy="${Y(v)}" r="3.5" fill="#d71920"/>`; } });
  const knee = kn.map((v, k) => v ? `<circle cx="${X(k)}" cy="${H - 8}" r="${v === 2 ? 6 : 4}" fill="${v === 2 ? '#d71920' : '#e8a33d'}"/>` : '').join('');
  const grid = [1, 3, 5].map(v => `<line x1="14" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="0" y="${Y(v) + 4}" font-size="10" fill="var(--mute)">${v}</text>`).join('');
  const notes = items.map(i => ({ i, e: entry(i.id) })).filter(x => x.e.m || x.e.tr).sort((a, b) => eff(a.i) < eff(b.i) ? 1 : -1).slice(0, 10);
  return `<div class="card"><b>Érzés és térd</b><div class="muted legend">piros vonal: heti átlagos érzés (1 nehéz – 5 könnyű) · alul: <span style="color:#e8a33d">●</span> térd érzem, <span style="color:#d71920">●</span> fáj</div>
    ${pts.some(v => v != null) || kn.some(v => v) ? `<svg viewBox="0 0 ${W} ${H}" width="100%">${grid}<path d="${path}" fill="none" stroke="#d71920" stroke-width="2"/>${dots}${knee}</svg>` : '<div class="muted" style="padding:8px 0">Még nincs értékelt edzés. Kipipáláskor add meg, hogy ment, és hogy érezted-e a térdedet.</div>'}
    ${notes.length ? `<div class="notes">${notes.map(x => `<div class="nrow"><span class="muted">${fmtD(eff(x.i))}</span> <b>${esc(LABEL(x.i.sport))}</b> ${x.e.tr ? `<span class="kn k${x.e.tr}">térd: ${['rendben', 'érzem', 'fáj'][x.e.tr]}</span>` : ''}${x.e.m ? `<div>${esc(x.e.m)}</div>` : ''}</div>`).join('')}</div>` : ''}</div>`;
}
function poolSlots(u, d) {
  const z = (u.zarva || []).find(x => d >= x[0] && d <= x[1]);
  if (z) return { zarva: z };
  if (u.datum && u.datum[d]) return { s: u.datum[d], m: u.datumMegj && u.datumMegj[d] };
  const r = (u.rend || []).find(x => d >= x.tol && d <= x.ig);
  if (r) return { s: r.napok[String(parseD(d).getDay())] || [], m: r.m, heti: true };
  return null;
}
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
let uTab = 'nap';
const fmtT = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
// rács: 8 pálya × félórák; szabad = '1'
function poolGrid(u, d) {
  if (u.racs && u.racs[d]) { const st = toMin(u.racsKezd || '06:00'), step = u.racsLepes || 30; return { st, step, lanes: u.racs[d] }; }
  const r = poolSlots(u, d);
  if (!r || r.zarva || !u.palyaSzam || !r.s.some(s => s.pl)) return null;
  const st = 360, step = 30, n = 32;
  const lanes = Array.from({ length: u.palyaSzam }, (_, li) => { let s = ''; for (let k = 0; k < n; k++) { const a = st + k * step; s += r.s.some(x => x.pl && x.pl.includes(li + 1) && toMin(x.t) <= a && a + step <= toMin(x.v)) ? '1' : '0'; } return s; });
  return { st, step, lanes, m: r.m };
}
function gridHTML(g, isToday, nowMin) {
  const n = g.lanes[0].length, cols = `18px repeat(${n},1fr)`;
  const nowK = isToday ? Math.floor((nowMin - g.st) / g.step) : -1;
  let h = `<div class="glg"><span><i style="background:var(--Úszás)"></i>szabad</span><span><i style="background:#e5e5ea"></i>bérelt / zárva</span><span class="lgr">1 kocka = ${g.step} perc</span></div>`;
  h += `<div class="grid" style="grid-template-columns:${cols}">`;
  g.lanes.forEach((l, li) => { h += `<div class="gl">${li + 1}.</div>` + [...l].map((c, k) => `<div class="gc ${c === '1' ? 'f' : ''} ${k === nowK ? 'now' : ''}"></div>`).join(''); });
  h += `</div><div class="gax" style="grid-template-columns:${cols}"><span></span>`;
  for (let k = 0; k < n; k++) { const m = g.st + k * g.step; h += `<span>${m % 120 === 0 ? m / 60 : ''}</span>`; }
  return h + `</div>`;
}
function freeWindows(u, d) {
  const g = poolGrid(u, d), out = [];
  if (g) {
    const n = g.lanes[0].length; let s = null, mn = 99, mx = 0;
    for (let k = 0; k <= n; k++) {
      const f = k < n ? g.lanes.reduce((c, l) => c + (l[k] === '1' ? 1 : 0), 0) : 0;
      if (f >= 2) { if (s === null) { s = k; mn = f; mx = f; } else { mn = Math.min(mn, f); mx = Math.max(mx, f); } }
      else if (s !== null) { out.push({ a: g.st + s * g.step, b: g.st + k * g.step, n: mn, mx, tot: g.lanes.length }); s = null; }
    }
    return out;
  }
  const r = poolSlots(u, d);
  if (!r || r.zarva) return out;
  r.s.forEach(x => out.push({ a: toMin(x.t), b: toMin(x.v), n: x.n || (x.pl ? x.pl.length : null), tot: u.palyaSzam, p: x.p }));
  return out;
}
const SHORT = { hullam: 'Hullám – Abay', pte: 'PTE Uszoda', ank: 'ANK', pecsvarad: 'Pécsvárad' };
function renderMikor(t, nowMin) {
  let html = `<div class="muted" style="padding:4px 16px 8px">A következő 3 nap sávjai, ahol legalább 2 pálya szabad (vagy nyitva van), időrendben.</div>`;
  for (let k = 0; k < 3; k++) {
    const d = addDays(t, k), list = [];
    uszi.uszodak.forEach(u => freeWindows(u, d).forEach(w => { if (k > 0 || w.b > nowMin) list.push(Object.assign({ u }, w)); }));
    list.sort((x, y) => x.a - y.a || (y.n || 0) - (x.n || 0));
    html += `<div class="card day"><h3>${fmtD(d)} – ${NAPNEV[parseD(d).getDay()]}${k === 0 ? ' · ma' : k === 1 ? ' · holnap' : ''}</h3>`;
    html += list.length ? list.map(w => {
      const on = k === 0 && nowMin >= w.a && nowMin < w.b;
      const bars = w.n && w.tot ? `<div class="lb">${Array.from({ length: w.tot }, (_, i) => `<i class="${i < w.n ? 'f' : i < (w.mx || w.n) ? 'h' : ''}"></i>`).join('')}</div>` : '';
      return `<div class="mk ${on ? 'now' : ''}"><div class="mt">${fmtT(w.a)}</div><div class="mb"><div class="pn">${esc(SHORT[w.u.id] || w.u.nev)}</div><div class="pmed">${fmtT(w.a)}–${fmtT(w.b)} · ${w.n ? (w.n === w.tot ? 'mind a ' + w.n + ' pálya szabad' : (w.mx && w.mx > w.n ? w.n + '–' + w.mx : w.n) + ' szabad pálya') : esc(w.p || 'nyitva')}</div></div>${on ? '<em>most</em>' : bars}</div>`;
    }).join('') : `<div class="pz" style="padding:10px 16px">Nincs ismert szabad sáv.</div>`;
    html += `</div>`;
  }
  return html;
}
function renderUszoda() {
  const t = todayStr();
  if (!uDay) uDay = t;
  let html = `<div class="seg"><button data-utab="nap" class="${uTab === 'nap' ? 'on' : ''}">Pályák napra</button><button data-utab="mikor" class="${uTab === 'mikor' ? 'on' : ''}">Mikor menjek?</button></div>`;
  if (!uszi) { $('#main').innerHTML = html + '<div class="muted" style="padding:16px">Betöltés…</div>'; return; }
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  if (uTab === 'mikor') { $('#main').innerHTML = html + renderMikor(t, nowMin) + `<div class="muted" style="padding:12px 16px">Frissítve: ${esc(uszi.frissitve || '')}</div>`; return; }
  html += `<div class="chips">`;
  for (let k = 0; k < 14; k++) { const d = addDays(t, k), dd = parseD(d); html += `<button class="chip ${d === uDay ? 'on' : ''}" data-uday="${d}"><small>${k === 0 ? 'ma' : k === 1 ? 'holnap' : NAPNEV[dd.getDay()].slice(0, 3)}</small>${dd.getDate()}.</button>`; }
  html += `</div>`;
  const dd = parseD(uDay), isToday = uDay === t;
  html += `<div class="card day"><h3>${fmtD(uDay)} – ${NAPNEV[dd.getDay()]}${isToday ? ' · ma' : ''}</h3></div>`;
  uszi.uszodak.forEach(u => {
    const r = poolSlots(u, uDay), g = poolGrid(u, uDay);
    let body = '';
    if (r && r.zarva) body = `<div class="pz">Zárva (${esc(r.zarva[2] || '')}: ${fmtD(r.zarva[0])} – ${fmtD(r.zarva[1])})</div>`;
    else if (g) { body = gridHTML(g, isToday, nowMin); if (g.m) body += `<div class="pm">${esc(g.m)}</div>`; }
    else if (r && r.s.length) {
      const bar = r.s.map(s => { const a = Math.max(0, toMin(s.t) - 300), b = Math.min(1020, toMin(s.v) - 300); return `<i style="left:${100 * a / 1020}%;width:${100 * (b - a) / 1020}%"></i>`; }).join('');
      body = `<div class="tl">${bar}${isToday && nowMin >= 300 && nowMin <= 1320 ? `<b style="left:${100 * (nowMin - 300) / 1020}%"></b>` : ''}</div><div class="tlx"><span>5</span><span>9</span><span>13</span><span>17</span><span>21</span></div>`;
      body += r.s.map(s => { const on = isToday && nowMin >= toMin(s.t) && nowMin < toMin(s.v); return `<div class="ps ${on ? 'now' : ''}"><span class="pt">${s.t}–${s.v}</span><span>${esc(s.p || '')}${s.m ? `<small>${esc(s.m)}</small>` : ''}</span>${on ? '<em>most</em>' : ''}</div>`; }).join('');
      if (r.m) body += `<div class="pm">${esc(r.m)}</div>`;
    } else if (r) body = `<div class="pz">Ezen a napon nincs közönségúszás.</div>`;
    else body = `<div class="pz">${esc(u.nincs || 'Erre a napra még nincs adat.')}</div>`;
    html += `<div class="card pool"><div class="pn">${esc(u.nev)}</div>${u.medence ? `<div class="pmed">${esc(u.medence)}</div>` : ''}${body}
      ${u.info ? `<details class="pi"><summary>Tudnivalók</summary><div class="pm">${esc(u.info)}</div></details>` : ''}<a class="pl" href="${esc(u.forras)}" target="_blank" rel="noopener">Forrás megnyitása</a></div>`;
  });
  html += `<div class="muted" style="padding:12px 16px">Frissítve: ${esc(uszi.frissitve || '')}</div>`;
  $('#main').innerHTML = html;
}
function renderInfo() {
  let html = `<div class="card"><b>Fogalmak</b><table>${plan.fogalmak.map(f => `<tr><th style="width:38%">${esc(f.f)}</th><td>${esc(f.j)}</td></tr>`).join('')}</table></div>`;
  const b = beall();
  html += `<div class="card"><b>FTP és pulzuszónák</b>
    <label class="muted">FTP (watt) – a Zwift-teszt eredménye</label><input type="number" id="ftp" inputmode="numeric" value="${esc(b.ftp || '')}" placeholder="pl. 210">
    <button class="btn" id="ftpsave">Mentés</button>
    ${+b.ftp ? `<table style="margin-top:10px"><tr><th>Bicikli Z2 (56–75%)</th><td>${watts(56)}–${watts(75)} W</td></tr><tr><th>Sweet spot (88–94%)</th><td>${watts(88)}–${watts(94)} W</td></tr><tr><th>Küszöb (95–100%)</th><td>${watts(95)}–${watts(100)} W</td></tr><tr><th>Versenytempó (75–80%)</th><td>${watts(75)}–${watts(80)} W</td></tr></table>` : ''}
    <table style="margin-top:10px"><tr><th>Futás Z1</th><td>150 alatt</td></tr><tr><th>Futás Z2</th><td>150–158</td></tr><tr><th>Tempó</th><td>159–166</td></tr><tr><th>Küszöb</th><td>167–176</td></tr></table></div>`;
  html += `<div class="card"><b>Beállítások</b><div class="muted" style="margin:6px 0">Terv frissítve: ${esc(plan.frissitve || '')}${garmin.frissitve ? ' · Garmin-ellenőrzés: ' + esc(garmin.frissitve) : ''}</div>
    <button class="btn ghost" id="reload">Frissítés most</button> <button class="btn ghost" id="reset">Kulcs cseréje</button></div>`;
  $('#main').innerHTML = html;
  $('#reload').onclick = () => loadRemote();
  $('#ftpsave').onclick = () => { const v = Math.round(+$('#ftp').value); change('_beall', { ftp: v > 50 && v < 600 ? v : null }); render(); };
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
  plan.edzesek.forEach((x, k) => ORD[x.id] = k);
  const dl = Math.round((parseD(plan.verseny) - parseD(todayStr())) / 864e5);
  $('#sub').innerHTML = dl > 0 ? `Még <b>${dl}</b> nap a versenyig` : dl === 0 ? '<b>Ma van a verseny!</b>' : 'IRONMAN 70.3 St. Pölten';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  const y = window.scrollY;
  ({ ma: renderMa, het: renderHet, halad: renderHalad, uszoda: renderUszoda, info: renderInfo })[view]();
  if (y) window.scrollTo(0, y);
}

/* ---------- events ---------- */
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  view = b.dataset.v; if (view === 'het') weekIdx = currentWeekIdx();
  openId = null; window.scrollTo(0, 0); render();
});
$('#main').addEventListener('click', e => {
  if (Date.now() < noClickUntil) return;
  const chk = e.target.closest('[data-chk]');
  if (chk) {
    const id = chk.dataset.chk, cur = entry(id);
    change(id, cur.k ? { k: false } : { k: true, t: new Date().toISOString() });
    if (!cur.k) openId = id;
    render(); return;
  }
  const ut = e.target.closest('[data-utab]');
  if (ut) { uTab = ut.dataset.utab; window.scrollTo(0, 0); render(); return; }
  const ud = e.target.closest('[data-uday]');
  if (ud) { uDay = ud.dataset.uday; render(); return; }
  if (e.target.closest('#addbtn')) { addOpen = true; render(); setTimeout(() => { const f = $('.addform'); if (f) f.scrollIntoView({ block: 'center' }); }, 50); return; }
  if (e.target.id === 'ad-cancel') { addOpen = false; render(); return; }
  if (e.target.id === 'ad-save') {
    const n = $('#ad-n').value.trim(); if (!n) { $('#ad-n').focus(); return; }
    const id = 'x-' + Date.now(), k = $('#ad-k').checked, p = Math.round(+$('#ad-p').value) || null;
    change(id, { datum: $('#ad-d').value, sport: $('#ad-s').value, edzes: n, perc: p, k, t: k ? new Date().toISOString() : undefined });
    addOpen = false; render(); return;
  }
  if (e.target.closest('.addform')) return;
  const del = e.target.closest('[data-del]');
  if (del) { change(del.dataset.del, { del: true }); openId = null; render(); return; }
  const kb = e.target.closest('[data-knee]');
  if (kb) { const id = kb.closest('.it').dataset.id, v = Number(kb.dataset.knee); change(id, { tr: entry(id).tr === v ? 0 : v }); render(); return; }
  const rs = e.target.closest('[data-reset]');
  if (rs) { change(rs.dataset.reset, { d: null }); render(); return; }
  if (e.target.closest('select')) return;
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
$('#main').addEventListener('change', e => {
  const s = e.target.closest('[data-move]');
  if (s) { moveTo(s.dataset.move, s.value); }
});
function moveTo(id, date) {
  const it = allItems().find(x => x.id === id);
  if (!it || date === eff(it)) return;
  change(id, { d: date === it.datum ? null : date });
  render();
}

/* ---------- húzás (hosszú nyomás) ---------- */
let drag = null, noClickUntil = 0;
const mainEl = $('#main');
mainEl.addEventListener('touchstart', e => {
  if (view !== 'het' || e.touches.length > 1) return;
  const it = e.target.closest('.it[data-id]');
  if (!it || it.classList.contains('empty') || e.target.closest('.chk,textarea,select,button,.extra')) return;
  const t = e.touches[0];
  drag = { it, id: it.dataset.id, x: t.clientX, y: t.clientY, on: false };
  drag.timer = setTimeout(() => startDrag(), 450);
}, { passive: true });
mainEl.addEventListener('touchmove', e => {
  if (!drag) return;
  const t = e.touches[0];
  if (!drag.on) {
    if (Math.hypot(t.clientX - drag.x, t.clientY - drag.y) > 8) { clearTimeout(drag.timer); drag = null; }
    return;
  }
  e.preventDefault();
  drag.x = t.clientX; drag.y = t.clientY;
  moveGhost();
}, { passive: false });
function endTouch() {
  if (!drag) return;
  clearTimeout(drag.timer);
  if (drag.on) {
    const target = dayAt(drag.x, drag.y);
    cleanupDrag();
    noClickUntil = Date.now() + 400;
    if (target) moveTo(drag.id, target.dataset.date);
  }
  drag = null;
}
mainEl.addEventListener('touchend', endTouch);
mainEl.addEventListener('touchcancel', () => { if (drag) { clearTimeout(drag.timer); if (drag.on) cleanupDrag(); drag = null; } });
mainEl.addEventListener('contextmenu', e => { if (view === 'het' && e.target.closest('.it[data-id]')) e.preventDefault(); });
function startDrag() {
  if (!drag) return;
  drag.on = true;
  const r = drag.it.getBoundingClientRect();
  const g = drag.it.cloneNode(true);
  g.classList.add('dragghost'); g.classList.remove('open');
  g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px`;
  document.body.appendChild(g);
  drag.ghost = g; drag.off = drag.y - r.top;
  drag.it.classList.add('dragging');
  document.body.classList.add('dragmode');
  if (navigator.vibrate) navigator.vibrate(15);
  moveGhost();
}
function dayAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.day[data-date]') : null;
}
function moveGhost() {
  drag.ghost.style.top = (drag.y - drag.off) + 'px';
  const d = dayAt(drag.x, drag.y);
  document.querySelectorAll('.day.drop').forEach(x => { if (x !== d) x.classList.remove('drop'); });
  if (d) d.classList.add('drop');
  clearInterval(drag.scroll);
  const edge = drag.y < 120 ? -10 : drag.y > window.innerHeight - 130 ? 10 : 0;
  if (edge) drag.scroll = setInterval(() => { window.scrollBy(0, edge); if (drag) { const d2 = dayAt(drag.x, drag.y); document.querySelectorAll('.day.drop').forEach(x => x.classList.remove('drop')); if (d2) d2.classList.add('drop'); } }, 16);
}
function cleanupDrag() {
  clearInterval(drag.scroll);
  if (drag.ghost) drag.ghost.remove();
  drag.it.classList.remove('dragging');
  document.body.classList.remove('dragmode');
  document.querySelectorAll('.day.drop').forEach(x => x.classList.remove('drop'));
}

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
