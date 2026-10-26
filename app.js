'use strict';
/* =====================================================================
   Water & Food Tracker
   ---------------------------------------------------------------------
   API = ''  -> DEMO MODE: sample data, entries saved in this browser only.
   API = 'https://script.google.com/macros/s/.../exec'  -> reads/writes the Google Sheet
   (see Code.gs).
   ===================================================================== */
const API = 'https://script.google.com/macros/s/AKfycbwA25xqTe7YNT-VUdEnXFOH71pX8S0Ep-fJIz5cnqoPTb5PuHTEHcTCTm9MTjnbEvi8/exec';                       // <-- paste your Apps Script web app URL here
const TZ = 'Asia/Colombo';            // Sri Lanka time
const REFRESH_MS = 60000;             // how often the dashboard re-reads the sheet

/* The two cards (and chart views). Water goal comes from the "Goals" tab; food goal is always 3 meals. */
const METRICS = [
  { id: 'water', name: 'WATER', sub: 'Daily Intake',    unit: 'ml',    cap: 'ml',             color: 'blue',  icon: '<path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/>' },
  { id: 'food',  name: 'FOOD',  sub: 'Meals Complete',  unit: 'meals', cap: 'meals complete', color: 'peach', icon: '<path d="M7 3v7M4 3v4a3 3 0 0 0 6 0V3M7 10v11M17 3c-2.2 1.6-3 4.2-3 7h3v11"/>' }
];
const MEAL_DEFS = [{ id: 'breakfast', name: 'Breakfast' }, { id: 'lunch', name: 'Lunch' }, { id: 'dinner', name: 'Dinner' }];
const DEFAULT_GOALS = { water: 2500, food: 3 };
const WATER_ICON = '<path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/>';
const SNACK_ICON = '<path d="M5 19C5 10 10 5 20 4c0 10-4 16-12 16"/><path d="M5 19c3-5 6-8 10-10"/>';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString('en-US');
const r1 = n => Math.round(n * 10) / 10;
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------------- Sri Lanka date / time helpers ---------------- */
const PARTS = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'long' });
function nowCol() {
  const p = {}; PARTS.formatToParts(new Date()).forEach(x => p[x.type] = x.value);
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: p.weekday };
}
const keyOf = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
const toDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toKey = dt => dt.toISOString().slice(0, 10);
const addDays = (k, n) => toKey(new Date(toDate(k).getTime() + n * 864e5));
const todayKey = () => { const n = nowCol(); return keyOf(n.y, n.m, n.d); };
const short = k => { const d = toDate(k); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
const fullDate = k => { const d = toDate(k); return DOW[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

/* ---------------- state ---------------- */
let today = todayKey();
let GOALS = { ...DEFAULT_GOALS };
const DATA = { days: {}, meals: {} };            // days['2026-10-26'] = { water }   meals['2026-10-26'] = { breakfast:{d,t}, lunch:{d,t}, dinner:{d,t}, snack:'' }
let metric = 'water', tab = '1W', demo = !API, inflight = 0, fromCache = false;
let SEL = { a: today, b: null, ranging: false, pv: null };      // calendar selection
let view = { y: nowCol().y, m: nowCol().m - 1 };                // month shown in the calendar
const LS_LOG = 'wf_demo_log', LS_MEALS = 'wf_demo_meals', LS_CACHE = 'wf_cache';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const blankMeal = () => ({ breakfast: { d: false, t: '' }, lunch: { d: false, t: '' }, dinner: { d: false, t: '' }, snack: '' });
const getMeal = k => DATA.meals[k] || blankMeal();

const toast = t => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2400); };
const post = async body => (await fetch(API, { method: 'POST', body: JSON.stringify(body) })).json();

/* ---------------- demo data (stable per date) ---------------- */
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function demoDays() {
  const days = {}, n = nowCol(), frac = (n.h * 3600 + n.mi * 60 + n.s) / 86400;
  for (let i = 0; i < 400; i++) {
    const k = addDays(today, -i), r = rng(hash(k));
    if (i > 0 && r() < 0.07) continue;
    const f = i === 0 ? Math.max(frac, .15) : 1;
    days[k] = { water: Math.round((1500 + r() * 1700) * f / 50) * 50 };
  }
  lsGet(LS_LOG, []).forEach(e => { const d = days[e.date] || (days[e.date] = { water: 0 }); d.water = r1(d.water + (e.water || 0)); });
  return days;
}
function demoMeals() {
  const meals = {};
  for (let i = 1; i < 400; i++) {
    const k = addDays(today, -i), r = rng(hash('m' + k));
    if (r() < 0.08) continue;
    const e = blankMeal(); MEAL_DEFS.forEach(m => e[m.id].d = r() < 0.75); meals[k] = e;
  }
  return Object.assign(meals, lsGet(LS_MEALS, {}));
}
function useDemo() { demo = true; DATA.days = demoDays(); DATA.meals = demoMeals(); GOALS = { ...DEFAULT_GOALS }; }

/* ---------------- last-known data kept on this device (so a refresh never starts from zero) ---------------- */
function saveCache() { if (API && !demo) lsSet(LS_CACHE, { days: DATA.days, meals: DATA.meals, goals: GOALS }); }
function loadCache() {
  const c = lsGet(LS_CACHE, null); if (!c || !c.days) return false;
  DATA.days = c.days; DATA.meals = c.meals || {}; GOALS = { ...DEFAULT_GOALS, ...(c.goals || {}), food: DEFAULT_GOALS.food }; return true;
}

/* ---------------- loading ---------------- */
async function load(first) {
  if (!API) { useDemo(); renderAll(true); return; }
  try {
    const d = await (await fetch(API + '?t=' + Date.now())).json();
    if (d.error) throw new Error(d.error);
    if (inflight) return;                        // a save is still travelling - don't overwrite it with older sheet data
    demo = false; DATA.days = d.days || {}; DATA.meals = d.meals || {};
    GOALS = { ...DEFAULT_GOALS, ...(d.goals || {}), food: DEFAULT_GOALS.food };
    saveCache(); renderAll(first && !fromCache);
  } catch (e) {
    console.warn(e);
    if (first && fromCache) toast('Offline - showing last saved data');
    else if (first) { toast('Offline - showing sample data'); useDemo(); renderAll(true); }
  }
}
function renderAll(anim) { renderCards(); updateLabel(); paintSel(); draw(anim); }

/* =====================================================================
   FLIP CLOCK
   ===================================================================== */
function buildClock() {
  $$('#clock .tile').forEach(t => t.insertAdjacentHTML('afterbegin',
    '<div class="half top"><span></span></div><div class="half bot"><span></span></div><div class="half flap ftop top"><span></span></div><div class="half flap fbot bot"><span></span></div>'));
}
function setTile(tile, v) {
  const q = s => tile.querySelector(s + ' span'), old = tile.dataset.v;
  if (old === v) return;
  tile.dataset.v = v;
  if (old === undefined || reduce) { q('.top').textContent = v; q('.bot').textContent = v; return; }
  q('.top').textContent = v; q('.bot').textContent = old; q('.ftop').textContent = old; q('.fbot').textContent = v;
  const ft = tile.querySelector('.ftop'), fb = tile.querySelector('.fbot');
  ft.style.display = 'block';
  ft.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], { duration: 280, easing: 'ease-in' }).onfinish = () => {
    ft.style.display = 'none'; fb.style.display = 'block';
    fb.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }], { duration: 280, easing: 'ease-out' }).onfinish = () => { q('.bot').textContent = tile.dataset.v; fb.style.display = 'none'; };
  };
}
function tickClock() {
  const n = nowCol();
  setTile($('#t-h'), pad(n.h % 12 || 12)); setTile($('#t-m'), pad(n.mi));
  $('#ampm').textContent = n.h < 12 ? 'AM' : 'PM'; $('#wday').textContent = n.wd.toUpperCase();
  const k = keyOf(n.y, n.m, n.d);
  if (k !== today) {                                 // midnight in Sri Lanka
    const wasToday = SEL.a === today && !SEL.b; today = k;
    if (wasToday) SEL = { a: today, b: null, ranging: false, pv: null };
    renderCal(0); renderCards(); updateLabel(); draw(false);
  }
  progress(n);
}

/* =====================================================================
   PROGRESS BARS (day / week / month / year, Sri Lanka time)
   ===================================================================== */
function buildBars() {
  $('#bars').innerHTML = ['Day', 'Week', 'Month', 'Year'].map(n => `<div class="bar"><div class="track"><div class="fill" id="f-${n}"></div></div><span id="l-${n}">${n}: 0%</span></div>`).join('');
}
function progress(n) {
  const secs = n.h * 3600 + n.mi * 60 + n.s, dt = new Date(Date.UTC(n.y, n.m - 1, n.d));
  const dim = new Date(Date.UTC(n.y, n.m, 0)).getUTCDate();
  const doy = Math.round((dt - Date.UTC(n.y, 0, 1)) / 864e5), diy = (n.y % 4 === 0 && (n.y % 100 !== 0 || n.y % 400 === 0)) ? 366 : 365;
  const wk = (dt.getUTCDay() + 6) % 7;               // Monday = 0
  const v = { Day: secs / 86400, Week: (wk * 86400 + secs) / (7 * 86400), Month: ((n.d - 1) * 86400 + secs) / (dim * 86400), Year: (doy * 86400 + secs) / (diy * 86400) };
  for (const k in v) { const p = Math.round(v[k] * 100); $('#f-' + k).style.width = p + '%'; $('#l-' + k).textContent = k + ': ' + p + '%'; }
}

/* =====================================================================
   CALENDAR  (animation modelled on the reference video)
   - click a day: green marker pops in; a second marker follows the cursor
   - click again: range is set (click the same day twice = single day)
   - month change: new month slides in while the card height resizes smoothly
   ===================================================================== */
function selKeys() {
  const a = SEL.a, b = SEL.b; if (!b) return [a];
  const out = []; let k = a; for (let i = 0; i < 366 && k <= b; i++) { out.push(k); k = addDays(k, 1); } return out;
}
function renderCal(dir) {
  $('#ctitle').textContent = MONTHS[view.m] + ' ' + view.y;
  const first = Date.UTC(view.y, view.m, 1), start = new Date(first).getUTCDay();
  const dim = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate(), weeks = Math.ceil((start + dim) / 7);
  let html = '';
  for (let i = 0; i < weeks * 7; i++) {
    const dt = new Date(first + (i - start) * 864e5), out = dt.getUTCMonth() !== view.m;
    html += `<button type="button" class="d${out ? ' out' : ''}" data-k="${toKey(dt)}">${dt.getUTCDate()}</button>`;
  }
  const body = $('#calBody'), old = body.firstElementChild, g = document.createElement('div');
  g.className = 'grid'; g.innerHTML = html;
  if (!dir || !old || reduce) { body.replaceChildren(g); paintSel(); return; }
  const h0 = body.offsetHeight; body.style.height = h0 + 'px';
  body.replaceChildren(g); paintSel();
  g.animate([{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' });
  const h1 = g.offsetHeight; void body.offsetHeight; body.style.height = h1 + 'px';
  clearTimeout(renderCal.t); renderCal.t = setTimeout(() => body.style.height = '', 380);
}
function paintSel() {
  $$('#calBody .d').forEach(el => {
    const k = el.dataset.k;
    el.classList.toggle('sel', k === SEL.a || k === SEL.b);
    el.classList.toggle('pv', SEL.ranging && SEL.pv === k && k !== SEL.a);
    el.classList.toggle('today', k === today);
  });
}
function goMonth(delta) {
  view.m += delta; if (view.m < 0) { view.m = 11; view.y--; } if (view.m > 11) { view.m = 0; view.y++; }
  renderCal(delta);
}
function onDay(k) {
  const d = toDate(k);
  if (d.getUTCMonth() !== view.m || d.getUTCFullYear() !== view.y) {            // greyed day from the next / previous month
    const dir = (d.getUTCFullYear() * 12 + d.getUTCMonth()) > (view.y * 12 + view.m) ? 1 : -1;
    view.y = d.getUTCFullYear(); view.m = d.getUTCMonth(); renderCal(dir);
  }
  if (!SEL.ranging) SEL = { a: k, b: null, ranging: true, pv: null };
  else if (k === SEL.a) { SEL.ranging = false; SEL.pv = null; }
  else { const [a, b] = [SEL.a, k].sort(); SEL = { a, b, ranging: false, pv: null }; }
  paintSel(); renderCards(); updateLabel();
}
$('#calBody').addEventListener('click', e => { const b = e.target.closest('.d'); if (b) onDay(b.dataset.k); });
$('#calBody').addEventListener('mouseover', e => { const b = e.target.closest('.d'); if (b && SEL.ranging && SEL.pv !== b.dataset.k) { SEL.pv = b.dataset.k; paintSel(); } });
$('#cal').addEventListener('mouseleave', () => { if (SEL.ranging) { SEL.ranging = false; SEL.pv = null; paintSel(); } });
$('#cprev').onclick = () => goMonth(-1);
$('#cnext').onclick = () => goMonth(1);
$('#ctitle').onclick = () => { const n = nowCol(), dir = (n.y * 12 + n.m - 1) > (view.y * 12 + view.m) ? 1 : -1; if (n.y !== view.y || n.m - 1 !== view.m) { view = { y: n.y, m: n.m - 1 }; renderCal(dir); } SEL = { a: today, b: null, ranging: false, pv: null }; paintSel(); renderCards(); updateLabel(); };

/* =====================================================================
   WATER + FOOD CARDS
   ===================================================================== */
const mealsDone = k => { const e = DATA.meals[k]; return e ? MEAL_DEFS.reduce((s, m) => s + (e[m.id] && e[m.id].d ? 1 : 0), 0) : 0; };
const hasData = (k, id) => id === 'food' ? !!DATA.meals[k] : !!DATA.days[k];
const dayVal = (k, id) => id === 'food' ? mealsDone(k) : (DATA.days[k] ? (+DATA.days[k].water || 0) : 0);
function buildCards() {
  $('#cards').innerHTML = METRICS.map((m, i) => `<button type="button" class="coin ${m.color} reveal lift${m.id === metric ? ' on' : ''}" data-m="${m.id}" data-pop style="--dy:-90px;--i:${i + 1}">
    <div class="ctop"><div class="ci"><svg viewBox="0 0 24 24">${m.icon}</svg></div><em class="cp">0%</em></div>
    <div class="cname"><b>${esc(m.name)}</b><small>${esc(m.sub)}</small></div>
    <div class="cv"><strong>0</strong><span></span></div></button>`).join('');
}
function renderCards() {
  const keys = selKeys();
  METRICS.forEach(m => {
    const el = $(`.coin[data-m="${m.id}"]`); if (!el) return;
    const avg = keys.reduce((s, k) => s + dayVal(k, m.id), 0) / keys.length, goal = GOALS[m.id] || 1;
    const snack = m.id === 'food' && keys.length === 1 && getMeal(keys[0]).snack ? ' · + snack' : '';
    el.querySelector('.cp').textContent = Math.round(avg / goal * 100) + '%';
    el.querySelector('strong').textContent = fmt(r1(avg));
    el.querySelector('.cv span').textContent = (keys.length > 1 ? 'avg ' : '') + '/ ' + fmt(goal) + ' ' + m.cap + snack;
  });
}
function updateLabel() {
  $('#sel-label').textContent = SEL.b ? short(SEL.a) + ' – ' + short(SEL.b) + ' · daily average' : (SEL.a === today ? 'today · ' : '') + fullDate(SEL.a);
  $('#qdate').textContent = 'logging for ' + (logDate() === today ? 'today' : fullDate(logDate()));
  syncQuick();
}
$('#cards').addEventListener('click', e => {
  const b = e.target.closest('.coin'); if (!b) return;
  metric = b.dataset.m; $$('.coin').forEach(c => c.classList.toggle('on', c === b)); draw(true);
});

/* =====================================================================
   CHART (hand-drawn SVG: line, grid, dashed guide, tooltip card)
   ===================================================================== */
const TABS = [['1W', 7], ['2W', 14], ['1M', 30], ['3M', 91], ['1Y', 365]];
let S = null;
const keysBack = (end, n) => Array.from({ length: n }, (_, i) => addDays(end, -(n - 1 - i)));
function avgData(keys, id) { let s = 0, n = 0; keys.forEach(k => { if (hasData(k, id)) { s += dayVal(k, id); n++; } }); return n ? s / n : 0; }
function buildSeries() {
  const id = metric, n = TABS.find(t => t[0] === tab)[1], pts = [];
  if (tab === '1Y') {
    const b = toDate(today);
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - i, 1)), y = dt.getUTCFullYear(), mo = dt.getUTCMonth();
      const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      pts.push({ v: avgData(Array.from({ length: dim }, (_, j) => toKey(new Date(Date.UTC(y, mo, j + 1)))), id), label: MON[mo], full: MON[mo] + ' ' + y + ' · daily avg' });
    }
  } else if (tab === '3M') {
    for (let j = 12; j >= 0; j--) { const e = addDays(today, -7 * j), ks = keysBack(e, 7); pts.push({ v: avgData(ks, id), label: short(ks[0]), full: short(ks[0]) + ' – ' + short(e) + ' · daily avg' }); }
  } else {
    keysBack(today, n).forEach(k => pts.push({ v: dayVal(k, id), label: tab === '1W' ? DOW[toDate(k).getUTCDay()] : short(k), full: fullDate(k) }));
  }
  return { pts, avg: avgData(keysBack(today, n), id), prev: avgData(keysBack(addDays(today, -n), n), id) };
}
const niceStep = max => { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const un = (m, v) => m.id === 'food' && Math.abs(r1(v)) === 1 ? 'meal' : m.unit;   // "1 meal", "2 meals"
const signed = (v, u) => (v >= 0 ? '+' : '−') + fmt(Math.abs(r1(v))) + (u ? ' ' + u : '');

function buildTabs() { $('#tabs').innerHTML = TABS.map(t => `<button type="button" role="tab" data-t="${t[0]}" data-pop class="${t[0] === tab ? 'on' : ''}">${t[0]}</button>`).join(''); }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); draw(true); });

function draw(anim) {
  const box = $('#plot'), W = box.clientWidth, H = box.clientHeight; if (!W) return;
  const m = METRICS.find(x => x.id === metric), M = { l: 66, r: 18, t: 34, b: 38 }, pw = W - M.l - M.r, ph = H - M.t - M.b;
  S = buildSeries(); const n = S.pts.length, goal = GOALS[metric] || 0;
  const top0 = Math.max(...S.pts.map(p => p.v), goal, 1), step = niceStep(top0), top = Math.ceil(top0 / step) * step;
  const X = i => M.l + (n === 1 ? pw / 2 : 12 + (pw - 24) * i / (n - 1)), Y = v => M.t + ph - (v / top) * ph;
  Object.assign(S, { X, Y, M, W, H, pw });
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="yl" x="${M.l - 12}" y="${Y(v) + 5}" text-anchor="end">${fmt(v)}</text>`;
  const every = Math.ceil(n / Math.max(2, Math.floor(pw / 62)));
  S.pts.forEach((p, i) => { if (i % every === 0 || i === n - 1 && (n - 1) % every === 0) g += `<text class="xl" x="${X(i)}" y="${H - 10}" text-anchor="middle">${esc(p.label)}</text>`; });
  if (goal) g += `<line class="goal" x1="${M.l}" x2="${W - M.r}" y1="${Y(goal)}" y2="${Y(goal)}"/><text class="gt" x="${W - M.r}" y="${Y(goal) - 7}" text-anchor="end">goal ${fmt(goal)}</text>`;
  g += `<path class="line${anim && !reduce ? ' draw' : ''}" pathLength="1" d="${S.pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ')}"/>`;
  g += `<g id="hv" hidden><line class="vl" id="hvl"/><circle class="dot" id="hvd" r="6.5"/></g>`;
  const svg = $('#svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
  // summary box
  const d = S.avg - S.prev, pct = S.prev ? Math.round(d / S.prev * 100) : 0;
  $('#cs-name').textContent = m.name; $('#cs-sub').textContent = 'Daily Average';
  $('#cs-val').textContent = fmt(r1(S.avg)) + ' ' + un(m, S.avg);
  const de = $('#cs-delta'); de.textContent = S.prev ? signed(d, un(m, d)) + ' (' + (pct >= 0 ? '+' : '') + pct + '%)' : 'no earlier data'; de.classList.toggle('down', d < 0);
  hover(n - 1);
}
function hover(i) {
  if (!S) return; const p = S.pts[i], x = S.X(i), y = S.Y(p.v), m = METRICS.find(z => z.id === metric);
  $('#hv').removeAttribute('hidden');
  const l = $('#hvl'); l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', y); l.setAttribute('y2', S.H - S.M.b);
  const c = $('#hvd'); c.setAttribute('cx', x); c.setAttribute('cy', y);
  const diff = i > 0 ? p.v - S.pts[i - 1].v : null, tip = $('#tip');
  tip.innerHTML = `<small>${esc(p.full)}</small><b>${fmt(r1(p.v))} ${un(m, p.v)}</b>` + (diff === null ? '' : `<em class="${diff < 0 ? 'down' : ''}">${signed(diff, un(m, diff))}</em>`);
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(x, 80), S.W - 80) + 'px'; tip.style.top = y + 'px';
  tip.style.translate = y < 120 ? '-50% 18px' : '-50% calc(-100% - 16px)';
}
$('#plot').addEventListener('pointermove', e => {
  if (!S) return; const r = $('#plot').getBoundingClientRect(), n = S.pts.length; if (n < 2) return;
  const i = Math.round((e.clientX - r.left - S.M.l - 12) / ((S.pw - 24) / (n - 1)));
  hover(Math.max(0, Math.min(n - 1, i)));
});
$('#plot').addEventListener('pointerleave', () => S && hover(S.pts.length - 1));
new ResizeObserver(() => draw(false)).observe($('#plot'));

/* =====================================================================
   QUICK ADD  (5 cards: water, breakfast, lunch, dinner, extra snack)
   ===================================================================== */
const svgI = p => `<span class="qi"><svg viewBox="0 0 24 24">${p}</svg></span>`;
const logDate = () => (SEL.a > today ? today : SEL.a);
function buildQuick() {
  $('#qlist').innerHTML =
    `<li class="qc"><div class="qh">${svgI(WATER_ICON)}<b>Water</b></div>
       <div class="qrow"><input type="number" id="waterIn" min="0" max="10000" step="any" inputmode="decimal" placeholder="Amount in ml" aria-label="Water in millilitres"><button type="button" class="qbtn" id="waterAdd" data-pop>Add</button></div></li>`
    + MEAL_DEFS.map(m => `<li class="qc"><label class="qh"><input type="checkbox" class="mt" data-meal="${m.id}"><b>${m.name} done</b></label>
       <input type="text" class="mx" data-meal="${m.id}" maxlength="120" placeholder="What did you eat? Press Enter" enterkeyhint="done" aria-label="${m.name}: what did you eat"></li>`).join('')
    + `<li class="qc"><div class="qh">${svgI(SNACK_ICON)}<b>Extra snack</b></div>
       <input type="text" class="mx" data-meal="snack" maxlength="120" placeholder="Had a snack? Press Enter" enterkeyhint="done" aria-label="Extra snack"></li>`;
}
function syncQuick() {                                // show the selected day's ticks in the cards (food text is write-only: it clears once logged)
  const e = getMeal(logDate());
  $$('#qlist .mt').forEach(c => { c.checked = !!e[c.dataset.meal].d; });
}
async function logWater(ml) {
  const k = logDate(), had = !!DATA.days[k], d = DATA.days[k] || (DATA.days[k] = { water: 0 });
  d.water = r1((+d.water || 0) + ml);
  renderCards(); paintSel(); draw(false); inflight++;
  try {
    if (API && !demo) {
      const r = await post({ action: 'log', date: k, water: ml, note: 'Water' }); if (r.error) throw new Error(r.error);
      if (r.day && typeof r.day.water === 'number') { d.water = r.day.water; renderCards(); draw(false); }   // show exactly what the sheet now holds
      saveCache();
    } else { const l = lsGet(LS_LOG, []); l.push({ date: k, water: ml }); lsSet(LS_LOG, l); }
    toast('Logged · +' + fmt(ml) + ' ml · ' + (k === today ? 'today' : short(k)));
  } catch (e) {
    d.water = r1(d.water - ml); if (!had) delete DATA.days[k];
    renderCards(); paintSel(); draw(false); toast('Not Saved - Check Connection');
  } finally { inflight--; }
}
async function saveMeal(k, meal, patch, restore) {   // patch = { d: true|false }  or  { add: 'food typed' }
  const before = DATA.meals[k] ? JSON.parse(JSON.stringify(DATA.meals[k])) : null, e = DATA.meals[k] || (DATA.meals[k] = blankMeal());
  const cat = (a, b) => a ? a + ', ' + b : b, name = meal === 'snack' ? 'Extra Snack' : MEAL_DEFS.find(m => m.id === meal).name;
  if (meal === 'snack') { if (patch.add) e.snack = cat(e.snack, patch.add); }
  else { if (patch.d !== undefined) e[meal].d = patch.d; if (patch.add) e[meal].t = cat(e[meal].t, patch.add); }
  renderCards(); draw(false); inflight++;
  try {
    if (API && !demo) {
      const r = await post({ action: 'meal', date: k, meal, ...patch}); if (r.error) throw new Error(r.error);
      if (patch.add && r.ver !== 2) throw new Error('Code.gs is outdated');   // an old Code.gs would say "ok" without saving the food
      saveCache();
    } else lsSet(LS_MEALS, { ...lsGet(LS_MEALS, {}), [k]: e });
    toast((patch.add ? 'Logged · ' + name + ' · ' + (patch.add.length > 28 ? patch.add.slice(0, 27) + '…' : patch.add) : 'Saved · ' + name) + ' · ' + (k === today ? 'today' : short(k)));
  } catch (err) {
    if (before) DATA.meals[k] = before; else delete DATA.meals[k];
    renderCards(); draw(false); syncQuick(); if (restore) restore();
    toast(/outdated/.test(err.message) ? 'Redeploy The New Code.gs' : 'Not Saved - Check Connection');
  } finally { inflight--; }
}
$('#qlist').addEventListener('change', e => { const t = e.target; if (t.classList.contains('mt')) saveMeal(logDate(), t.dataset.meal, { d: t.checked }); });
function logFood(i) {                                  // Enter pressed: log the food to the sheet, then clear the box
  const v = i.value.trim().slice(0, 120); i.value = ''; if (!v) return;
  saveMeal(logDate(), i.dataset.meal, { add: v }, () => { if (!i.value) i.value = v; });
}
function addWater() {
  const i = $('#waterIn'), v = Number(i.value);
  if (!(v > 0)) return toast('Enter A Water Amount');
  if (v > 10000) return toast('Max 10,000 ml At Once');
  i.value = ''; logWater(v);
}
$('#qlist').addEventListener('click', e => { if (e.target.closest('#waterAdd')) addWater(); });
$('#qlist').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'waterIn') { e.preventDefault(); addWater(); }
  else if (e.target.classList.contains('mx')) { e.preventDefault(); logFood(e.target); }
});

/* click "pop" feedback + keyboard */
document.addEventListener('click', e => { const m = e.target.closest('[data-pop]'); if (!m) return; m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop'); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (document.activeElement && document.activeElement.matches('input'))) return;
  SEL = { a: today, b: null, ranging: false, pv: null }; paintSel(); renderCards(); updateLabel();
});

/* =====================================================================
   START
   ===================================================================== */
buildClock(); buildBars(); buildCards(); buildTabs(); renderCal(0); buildQuick(); updateLabel();
tickClock(); setInterval(tickClock, 1000);
if (API && loadCache()) { fromCache = true; renderAll(true); }   // show the last saved numbers straight away, then update from the sheet
load(true); if (API) setInterval(() => load(false), REFRESH_MS);
