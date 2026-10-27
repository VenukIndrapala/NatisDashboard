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
    if (d.mood && !moodBusy) { MOOD = d.mood; lsSet(LS_MOOD, MOOD); paintMood(); }   // today's mood bars from the sheet
    if (typeof d.quote === 'string') setQuote(d.quote);                              // today's quote from the "Quote" tab (no "quote" key = old Code.gs, keep what we have)
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
    renderCal(0); renderCards(); updateLabel(); draw(false); paintMood();
  }
}

/* =====================================================================
   MOOD BARS (Happy / Sads / Annoyed / Hungry) - drag each bar 0-10 for today
   - the bar fills smoothly under the finger / mouse, then snaps to the nearest whole number on release
   - saved per day on the "Mood" tab; a new day (Sri Lanka time) starts again at 0
   ===================================================================== */
const MOODS = [['happy', 'Happy'], ['sads', 'Sads'], ['annoyed', 'Annoyed'], ['hungry', 'Hungry']];
const LS_MOOD = 'wf_mood';
let MOOD = lsGet(LS_MOOD, {});                       // { '2026-10-27': { happy: 7, sads: 0, annoyed: 2, hungry: 5 } }
let moodDrag = null, moodBusy = 0;                   // moodDrag = { id, raw, before } while a bar is being dragged
function buildBars() {
  $('#bars').innerHTML = MOODS.map(([id, n]) => `<div class="bar mood" data-id="${id}"><div class="track" role="slider" tabindex="0" aria-label="${n}" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0"><div class="fill" id="f-${id}"></div></div><span id="l-${id}">${n}: 0</span></div>`).join('');
  paintMood();
}
function paintMood() {
  const m = MOOD[today] || {};
  MOODS.forEach(([id, n]) => {
    const v = moodDrag && moodDrag.id === id ? moodDrag.raw : (+m[id] || 0);
    $('#f-' + id).style.width = (v * 10) + '%';
    $('#l-' + id).textContent = n + ': ' + Math.round(v);
    $('#f-' + id).parentElement.setAttribute('aria-valuenow', Math.round(v));
  });
}
const moodX = (t, x) => { const r = t.getBoundingClientRect(); return Math.max(0, Math.min(10, (x - (r.left + 7)) / (r.width - 14) * 10)); };   // 7px = 3px border + 4px padding
async function saveMood(k, id, v, before) {
  moodBusy++;
  try {
    if (API && !demo) {
      const r = await post({ action: 'mood', date: k, key: id, v }); if (r.error) throw new Error(r.error);
      if (r.mood !== true) throw new Error('outdated');                  // an old Code.gs would say "ok" without saving
    }
    lsSet(LS_MOOD, MOOD);
    toast('Saved · ' + MOODS.find(m => m[0] === id)[1] + ' · ' + v + '/10');
  } catch (err) {
    MOOD[k] = Object.assign({}, MOOD[k], { [id]: before }); paintMood();
    toast(/outdated/.test(err.message) ? 'Redeploy The New Code.gs' : 'Not Saved - Check Connection');
  } finally { moodBusy--; }
}
function setMood(id, v) {
  const k = today, before = +(MOOD[k] || {})[id] || 0;
  MOOD[k] = Object.assign({}, MOOD[k], { [id]: v }); paintMood();
  if (v !== before) saveMood(k, id, v, before);
}
function endMoodDrag() {
  if (!moodDrag) return;
  const { id, raw } = moodDrag; moodDrag = null;
  $('#f-' + id).closest('.bar').classList.remove('drag');
  setMood(id, Math.round(raw)); moodBusy--;
}
$('#bars').addEventListener('pointerdown', e => {
  const t = e.target.closest('.track'); if (!t || moodDrag) return;
  const row = t.closest('.bar'); moodDrag = { id: row.dataset.id, raw: moodX(t, e.clientX) };
  row.classList.add('drag'); t.setPointerCapture(e.pointerId); moodBusy++; paintMood(); e.preventDefault();
});
$('#bars').addEventListener('pointermove', e => { if (moodDrag) { moodDrag.raw = moodX($('#f-' + moodDrag.id).parentElement, e.clientX); paintMood(); } });
$('#bars').addEventListener('pointerup', endMoodDrag);
$('#bars').addEventListener('pointercancel', endMoodDrag);
$('#bars').addEventListener('keydown', e => {
  const t = e.target.closest('.track'); if (!t) return;
  const id = t.closest('.bar').dataset.id, cur = +(MOOD[today] || {})[id] || 0;
  const v = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? cur + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? cur - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? 10 : null;
  if (v === null) return; e.preventDefault(); setMood(id, Math.max(0, Math.min(10, v)));
});

/* =====================================================================
   NOTE BOX ("Anything She Wants To Say Or Talk About?") - each entry is logged as a new row on the "Notes" tab
   ===================================================================== */
const LS_NOTES = 'wf_demo_notes';
async function saveNote() {
  const el = $('#noteIn'), v = el.value.trim().slice(0, 1000);
  if (!v) return toast('Type Something First');
  el.value = '';
  try {
    if (API && !demo) {
      const r = await post({ action: 'note', date: today, text: v }); if (r.error) throw new Error(r.error);
      if (r.note !== true) throw new Error('outdated');                  // an old Code.gs would say "ok" without saving
    } else { const l = lsGet(LS_NOTES, []); l.push({ date: today, text: v }); lsSet(LS_NOTES, l); }
    toast('Logged · Note · today');
  } catch (err) {
    if (!el.value) el.value = v;                                          // keep what she wrote so nothing is lost
    toast(/outdated/.test(err.message) ? 'Redeploy The New Code.gs' : 'Not Saved - Check Connection');
  }
}
$('#noteBtn').addEventListener('click', saveNote);
$('#noteIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveNote(); } });

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
       <div class="qrow"><span class="fx"><input type="number" id="waterIn" min="0" max="10000" step="any" inputmode="decimal" placeholder="Amount in ml" aria-label="Water in millilitres"></span><button type="button" class="qbtn" id="waterAdd" data-pop>Add</button></div></li>`
    + MEAL_DEFS.map(m => `<li class="qc"><label class="qh"><input type="checkbox" class="mt" data-meal="${m.id}"><b>${m.name} done</b></label>
       <span class="fx"><input type="text" class="mx" data-meal="${m.id}" maxlength="120" enterkeyhint="done" aria-label="${m.name}: what did you eat"></span></li>`).join('')
    + `<li class="qc"><div class="qh">${svgI(SNACK_ICON)}<b>Extra snack</b></div>
       <span class="fx"><input type="text" class="mx" data-meal="snack" maxlength="120" enterkeyhint="done" aria-label="Extra snack"></span></li>`;
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

/* =====================================================================
   POOP CARD + FLOAT + TREND CHART  (runs after the dashboard above has started)
   ===================================================================== */
const LS_POOP = 'wf_poop';
const PT = [['1W', 7], ['2W', 14], ['1M', 30], ['3M', 91], ['1Y', 365]];
let POOP = lsGet(LS_POOP, {});                 // { '2026-10-26': true }
let ptab = '1W', PS = null, flying = false, shownDay = today;
const pv = k => (POOP[k] && !(flying && k === today)) ? 1 : 0;   // today only counts once the poop has landed
const psum = ks => ks.reduce((s, k) => s + pv(k), 0);
const dayWord = n => Math.abs(n) === 1 ? 'day' : 'days';

/* ---------------- build ---------------- */
function buildPoop() {
  $('#cards').insertAdjacentHTML('beforeend',
    `<div class="pcard reveal lift" id="pcard" style="--dy:-90px;--i:3">
       <div class="ptop"><div class="cname"><b>Daily Poop Check</b><small id="psub">Daily Check</small></div>
         <div class="pslot"><img id="phero" src="poop.png" alt="Poop character" draggable="false"></div></div>
       <label class="pcheck"><span>Did You Poop Today? Yes?</span><input type="checkbox" id="pbox"></label>
     </div>`);
  $('.chartcard').insertAdjacentHTML('afterend',
    `<div class="chartcard reveal" id="pchart" style="--dy:90px;--i:7">
       <div class="chead">
         <div class="csum"><div class="cs-l"><b>POOP</b><small>Days Pooped</small></div>
           <div class="cs-r"><strong id="ps-val"></strong><em id="ps-delta"></em></div></div>
         <div class="tabs" id="ptabs" role="tablist"></div>
       </div>
       <div class="plot" id="pplot"><svg id="psvg" role="img" aria-label="Poop trend chart"></svg><div class="tip" id="ptip" hidden></div></div>
     </div>`);
  $('#ptabs').innerHTML = PT.map(t => `<button type="button" role="tab" data-t="${t[0]}" data-pop class="${t[0] === ptab ? 'on' : ''}">${t[0]}</button>`).join('');
}
function prender() {
  const done = !!POOP[today];
  const box = $('#pbox'); box.checked = done; box.disabled = done || flying;
  $('#psub').textContent = done ? 'Done For Today' : 'Daily Check';
  if (!flying) $('#phero').classList.toggle('gone', done);
}

/* ---------------- chart ---------------- */
function pSeries() {
  const n = PT.find(t => t[0] === ptab)[1], pts = [];
  if (ptab === '1Y') {
    const b = toDate(today);
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - i, 1)), y = dt.getUTCFullYear(), mo = dt.getUTCMonth();
      const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      pts.push({ v: psum(Array.from({ length: dim }, (_, j) => toKey(new Date(Date.UTC(y, mo, j + 1))))), label: MON[mo], full: MON[mo] + ' ' + y + ' · days pooped' });
    }
  } else if (ptab === '3M') {
    for (let j = 12; j >= 0; j--) { const e = addDays(today, -7 * j), ks = keysBack(e, 7); pts.push({ v: psum(ks), label: short(ks[0]), full: short(ks[0]) + ' – ' + short(e) + ' · days pooped' }); }
  } else {
    keysBack(today, n).forEach(k => pts.push({ v: pv(k), label: ptab === '1W' ? DOW[toDate(k).getUTCDay()] : short(k), full: fullDate(k) }));
  }
  return { pts, daily: ptab !== '3M' && ptab !== '1Y', total: psum(keysBack(today, n)), prev: psum(keysBack(addDays(today, -n), n)) };
}
function pdraw(anim, lt) {                       // lt (0..1) = how far today's newest point has risen from the axis
  const box = $('#pplot'), W = box.clientWidth, H = box.clientHeight; if (!W) return;
  const M = { l: 66, r: 18, t: 34, b: 38 }, pw = W - M.l - M.r, ph = H - M.t - M.b;
  PS = pSeries(); const n = PS.pts.length, d = PS.daily;
  const top0 = Math.max(...PS.pts.map(p => p.v), 1), step = d ? 1 : Math.max(1, Math.ceil(niceStep(top0))), top = d ? 1 : Math.ceil(top0 / step) * step;
  const X = i => M.l + (n === 1 ? pw / 2 : 12 + (pw - 24) * i / (n - 1)), Y = v => M.t + ph - (v / top) * ph;
  PS.vals = PS.pts.map((p, i) => i === n - 1 && lt !== undefined ? p.v - 1 + lt : p.v);
  Object.assign(PS, { X, Y, M, W, H, pw });
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="yl" x="${M.l - 12}" y="${Y(v) + 5}" text-anchor="end">${d ? (v ? 'Yes' : 'No') : fmt(v)}</text>`;
  const every = Math.ceil(n / Math.max(2, Math.floor(pw / 62)));
  PS.pts.forEach((p, i) => { if (i % every === 0 || i === n - 1 && (n - 1) % every === 0) g += `<text class="xl" x="${X(i)}" y="${H - 10}" text-anchor="middle">${esc(p.label)}</text>`; });
  g += `<path class="line${anim && !reduce ? ' draw' : ''}" pathLength="1" d="${PS.vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')}"/>`;
  g += `<g id="phv" hidden><line class="vl" id="phvl"/><circle class="dot" id="phvd" r="6.5"/></g>`;
  const svg = $('#psvg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
  const t = PS.total, dl = t - PS.prev, pct = PS.prev ? Math.round(dl / PS.prev * 100) : 0;
  $('#ps-val').textContent = t + ' ' + dayWord(t);
  const de = $('#ps-delta'); de.textContent = PS.prev ? signed(dl, dayWord(dl)) + ' (' + (pct >= 0 ? '+' : '') + pct + '%)' : 'no earlier data'; de.classList.toggle('down', dl < 0);
  phover(n - 1);
}
function phover(i) {
  if (!PS) return; const p = PS.pts[i], x = PS.X(i), y = PS.Y(PS.vals[i]), d = PS.daily;
  $('#phv').removeAttribute('hidden');
  const l = $('#phvl'); l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', y); l.setAttribute('y2', PS.H - PS.M.b);
  const c = $('#phvd'); c.setAttribute('cx', x); c.setAttribute('cy', y);
  const diff = i > 0 ? p.v - PS.pts[i - 1].v : null, tip = $('#ptip');
  tip.innerHTML = `<small>${esc(p.full)}</small><b>${d ? (p.v ? 'Yes' : 'No') : p.v + ' ' + dayWord(p.v)}</b>` + (!d && diff !== null ? `<em class="${diff < 0 ? 'down' : ''}">${signed(diff, dayWord(diff))}</em>` : '');
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(x, 80), PS.W - 80) + 'px'; tip.style.top = y + 'px';
  tip.style.translate = y < 120 ? '-50% 18px' : '-50% calc(-100% - 16px)';
}
function animLast() {                            // the poop has merged into the chart: the line draws in and today's point pops into place (nothing rises from the axis)
  pdraw(true);
  const c = $('#phvd'); if (!c || reduce) return;
  c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center';
  c.animate([{ scale: 0 }, { scale: 1.5, offset: .6 }, { scale: 1 }], { duration: 500, delay: 850, easing: 'ease-out', fill: 'both' });
}

/* ---------------- the float (fish offset-path movement) ---------------- */
function flyPath(sx, sy, ex, ey) {               // wavy S-curve from the card down to the axis (smooth quadratic chain, like the fish's swim path)
  const n = 4, dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1, px = -dy / len, py = dx / len, amp = Math.min(120, len / 4);
  const pt = i => [sx + dx * i / n, sy + dy * i / n], f = v => v.toFixed(1);
  let d = `M${f(sx)} ${f(sy)} Q${f(sx + dx * .5 / n + px * amp)} ${f(sy + dy * .5 / n + py * amp)} ${f(pt(1)[0])} ${f(pt(1)[1])}`;
  for (let i = 2; i <= n; i++) d += ` T${f(pt(i)[0])} ${f(pt(i)[1])}`;
  return d;
}
function splash(x, y) {
  const s = document.createElement('div'); s.className = 'psplash'; s.style.left = x + 'px'; s.style.top = y + 'px';
  s.innerHTML = '<i></i><i></i>'; document.body.appendChild(s); setTimeout(() => s.remove(), 1100);
}
function fly(sx, sy, w, h) {
  return new Promise(done => {
    pdraw(false);
    const r = $('#pplot').getBoundingClientRect(), ex = r.left + scrollX + PS.X(PS.pts.length - 1), ey = r.top + scrollY + PS.H - PS.M.b;
    const el = document.createElement('div'); el.className = 'pfly'; el.style.width = w + 'px'; el.style.height = h + 'px';
    el.innerHTML = `<img src="${$('#phero').src}" alt="">`;
    el.style.offsetPath = `path("${flyPath(sx, sy, ex, ey)}")`; document.body.appendChild(el);
    const dur = Math.max(2800, Math.min(4600, Math.hypot(ex - sx, ey - sy) * 4.5));
    const a = el.animate([
      { offsetDistance: '0%', opacity: 1, scale: 1 },
      { offsetDistance: '100%', opacity: 1, scale: 1, offset: .86 },        // linear swim, as in the fish code
      { offsetDistance: '100%', opacity: 0, scale: 0 }                       // sinks into the axis and vanishes (never flies back)
    ], { duration: dur, easing: 'linear', fill: 'forwards' });
    setTimeout(() => splash(ex, ey), dur * .86);
    a.onfinish = () => { el.remove(); done(); };
  });
}

/* ---------------- tick ---------------- */
async function poopTick() {
  const k = today; if (POOP[k] || flying) return;
  const hero = $('#phero'), r = hero.getBoundingClientRect(), sx = r.left + scrollX + r.width / 2, sy = r.top + scrollY + r.height / 2;
  POOP[k] = true; flying = true; prender(); hero.classList.add('gone');
  const saved = (async () => {
    try {
      if (API && !demo) {
        const j = await post({ action: 'poop', date: k, d: true });
        if (j.error) throw new Error(j.error);
        if (j.poop !== true) throw new Error('outdated');                  // an old Code.gs would say "ok" without saving
      }
      lsSet(LS_POOP, POOP); return '';
    } catch (e) { return /outdated/.test(e.message) ? 'Redeploy The New Code.gs' : 'Not Saved - Check Connection'; }
  })();
  if (!reduce) await fly(sx, sy, r.width, r.height);
  const err = await saved;
  if (err) {                                                                // save failed: the poop comes back, nothing is logged
    delete POOP[k]; flying = false; prender(); pdraw(false); toast(err);
    hero.classList.add('pop'); setTimeout(() => hero.classList.remove('pop'), 500); return;
  }
  flying = false; prender(); toast('Logged · Poop · today'); animLast();
}

/* ---------------- loading from the sheet ---------------- */
async function pload() {
  if (!API || demo || flying) return;
  try {
    const d = await (await fetch(API + '?t=' + Date.now())).json();
    if (d.error || !d.poop || flying) return;                              // no "poop" key = old Code.gs, keep what we have
    POOP = d.poop; lsSet(LS_POOP, POOP); prender(); pdraw(false);
  } catch (e) { console.warn(e); }
}

/* =====================================================================
   QUOTE CARD  (sits right next to the Poop card - no title, only the quote)
   - the quote is typed by whoever manages the sheet, on the "Quote" tab (Date | Quote)
   - Code.gs sends today's quote (or the latest earlier one) with the data the dashboard already reads every minute,
     so a new day's quote appears by itself - no extra request needed
   - the card's text uses the geometric sans-serif font (see --geo in style.css); long quotes shrink a little to fit
   ===================================================================== */
const LS_QUOTE = 'wf_quote';
const DEMO_QUOTE = 'Small steps every day add up to big things.';
const cleanQuote = t => String(t || '').replace(/\s+/g, ' ').trim().replace(/^[“”"]+|[“”"]+$/g, '').trim().slice(0, 200);   // the card adds its own quote marks
let QUOTE = cleanQuote(lsGet(LS_QUOTE, ''));                               // last quote seen on this device, shown instantly on refresh
function buildQuote() {
  $('#cards').insertAdjacentHTML('beforeend',
    `<div class="quotecard reveal lift" id="quotecard" style="--dy:-90px;--i:4"><p class="quotetext" id="quotetext"></p></div>`);
  if (!API && !QUOTE) QUOTE = DEMO_QUOTE;                                  // demo mode: show a sample
  paintQuote();
}
function paintQuote() {
  const el = $('#quotetext'); if (!el) return;
  const n = QUOTE.length;
  el.textContent = QUOTE; el.classList.toggle('has', n > 0);
  el.style.setProperty('--qs', (n <= 50 ? 22 : n <= 90 ? 19 : n <= 140 ? 17 : n <= 180 ? 15 : 14) + 'px');
}
function setQuote(t) { QUOTE = cleanQuote(t); lsSet(LS_QUOTE, QUOTE); paintQuote(); }

/* ---------------- start ---------------- */
buildPoop(); buildQuote(); prender(); pdraw(true);
$('#pbox').addEventListener('change', e => { if (e.target.checked) poopTick(); else prender(); });
$('#ptabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ptab = b.dataset.t; $$('#ptabs button').forEach(x => x.classList.toggle('on', x === b)); pdraw(true); });
$('#pplot').addEventListener('pointermove', e => {
  if (!PS) return; const r = $('#pplot').getBoundingClientRect(), n = PS.pts.length; if (n < 2) return;
  phover(Math.max(0, Math.min(n - 1, Math.round((e.clientX - r.left - PS.M.l - 12) / ((PS.pw - 24) / (n - 1))))));
});
$('#pplot').addEventListener('pointerleave', () => PS && phover(PS.pts.length - 1));
new ResizeObserver(() => { if (!flying) pdraw(false); }).observe($('#pplot'));
setInterval(() => {                              // new day: the box unlocks and the character comes back; the log and chart history stay
  if (today === shownDay) return; shownDay = today;
  prender(); pdraw(false);
  const h = $('#phero'); h.classList.add('pop'); setTimeout(() => h.classList.remove('pop'), 500);
}, 1000);
pload(); if (API) setInterval(pload, REFRESH_MS);

/* =====================================================================
   KOI FISH  (two fish resting beside the cow)
   ---------------------------------------------------------------------
   - at rest they are frozen on a straight stretch of the koi path, small, next to the cow (CSS-driven, see the "Two koi" block in style.css)
   - tap a fish: both start swimming from EXACTLY where they are sitting (nothing is dragged to the centre)
     and then wander wherever they like - there is no fixed path any more
   - tap again: they turn, swim back to the cow, shrink and settle in their resting pose
   ===================================================================== */
const pond = $('#pond'), fishEls = $$('#pond .fish');
const fishCoils = fishEls.map(f => [...f.querySelectorAll('.koiCoil')]);   // 15 segments per fish, tail (0) ... head (14)
const REST_S = .78;                                // size of the resting fish
const HEAD = 14;
const SCALE_ME = [1, 1.2, 1.35, 1.55, 1.75, 1.9, 2, 2, 2, 1.9, 1.75, 1.55, 1.35, 1.2, 1];   // body thickness per segment (same as the CSS --scaleMe values)
let fstate = 'rest', fC = [], fShape = [], fRaf = 0, swimRaf = 0, SW = null;   // fstate: rest | roam | back | settle
const fishT = (i, tx, ty, s) => `translate(${tx}px,${ty}px) scale(${i === 1 ? -s : s},${s})`;   // the 2nd fish is the mirror image, as in the fish page
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const centreOf = el => { const r = el.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };

/* ---------------- resting pose ---------------- */
function fishCentres() {                           // centre of each resting fish + the shape of its body around that centre (before it is moved next to the cow)
  fC = []; fShape = [];
  fishEls.forEach((f, i) => {
    f.classList.remove('glide'); f.style.transform = fishT(i, 0, 0, REST_S);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const pts = [...f.children].map(c => { const r = c.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); return [(r.left + r.right) / 2, (r.top + r.bottom) / 2]; });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    fC.push([cx, cy]); fShape.push(pts.map(p => [p[0] - cx, p[1] - cy]));
  });
}
function fishRestSpots() {                         // where each resting fish should sit: just left of the cow, one above the other
  const c = $('.cow'); if (!c) return null; const r = c.getBoundingClientRect(); if (!r.width) return null;
  return [[r.left - 92, r.top + r.height * .30], [r.left - 112, r.top + r.height * .72]];
}
function layoutFish() {
  if (fstate !== 'rest') return;
  if (fC.length !== fishEls.length) fishCentres();
  const sp = fishRestSpots(); if (!sp) return;
  fishEls.forEach((f, i) => { f.classList.remove('glide'); f.style.transform = fishT(i, sp[i][0] - fC[i][0], sp[i][1] - fC[i][1], REST_S); });
  pond.classList.add('ready');
}
function queueFish() { if (fstate !== 'rest' || fRaf) return; fRaf = requestAnimationFrame(() => { fRaf = 0; layoutFish(); }); }

/* ---------------- free swimming ---------------- */
function fishOut() {                               // swim off - starting from the exact pose each fish is resting in
  const bodies = fishCoils.map(cs => cs.map(centreOf));                      // where every segment is right now (screen px)
  fishEls.forEach(f => { f.classList.remove('glide'); f.style.transform = 'translate(0px,0px) scale(1,1)'; });
  fishCoils.forEach(cs => cs.forEach(c => { c.style.offsetPath = 'none'; c.style.transform = 'none'; }));   // leave the fixed path: from now on the code places every segment
  const base = fishCoils.map(cs => centreOf(cs[0]));                         // where an un-moved segment sits (all segments share it)
  SW = {
    base, fs: REST_S, fsT: 1, last: performance.now(), backT: 0, settleT: 0,
    fish: bodies.map(p => {
      let s = 0; for (let k = 0; k < HEAD; k++) s += Math.hypot(p[k + 1].x - p[k].x, p[k + 1].y - p[k].y);
      return { p, d: s / HEAD / REST_S, th: Math.atan2(p[HEAD].y - p[10].y, p[HEAD].x - p[10].x), v: 25, vt: rnd(80, 140), w: 0, wt: 0, tTurn: 0, tSpeed: rnd(1, 2.5), ph: rnd(0, 6.28), amp: 0, dist: 1e9 };
    })
  };
  fstate = 'roam';
  if (!swimRaf) swimRaf = requestAnimationFrame(swimStep);
}
function fishBack() { fstate = 'back'; SW.fsT = REST_S; SW.backT = 0; }

function steer(F, dt, W, H, goal) {                // moves the head; the body follows it
  const h = F.p[HEAD];
  if (goal) {                                      // heading home: aim at the resting spot and slow down as it gets close
    F.dist = Math.hypot(goal.x - h.x, goal.y - h.y);
    F.w = clamp(angDiff(Math.atan2(goal.y - h.y, goal.x - h.x), F.th) * 4, -3.2, 3.2);
    F.vt = clamp(F.dist * 1.8, 45, 260);
    F.v += (F.vt - F.v) * (1 - Math.exp(-dt * 4));
  } else {                                         // wandering: random gentle turns, speed changes and the odd quick dart
    F.tTurn -= dt; if (F.tTurn <= 0) { F.wt = rnd(-1.4, 1.4) * (Math.random() < .15 ? 1.8 : 1); F.tTurn = rnd(.7, 2.6); }
    F.tSpeed -= dt; if (F.tSpeed <= 0) { const dart = Math.random() < .12; F.vt = dart ? rnd(230, 290) : rnd(70, 180); F.tSpeed = dart ? rnd(.4, .8) : rnd(1.2, 3.2); }
    F.w += (F.wt - F.w) * (1 - Math.exp(-dt * 3));
    const m = 140; let ax = 0, ay = 0;             // near a screen edge: turn back towards the middle
    if (h.x < m) ax += (m - h.x) / m; if (h.x > W - m) ax -= (h.x - (W - m)) / m;
    if (h.y < m) ay += (m - h.y) / m; if (h.y > H - m) ay -= (h.y - (H - m)) / m;
    const push = Math.hypot(ax, ay);
    if (push > 0) { const k = Math.min(1, push * 2); F.w = F.w * (1 - k) + clamp(angDiff(Math.atan2(ay, ax), F.th) * 3, -2.6, 2.6) * k; }
    F.w = clamp(F.w, -2.6, 2.6);
    F.v += (F.vt - F.v) * (1 - Math.exp(-dt * 1.6));
    F.dist = 1e9;
  }
  F.th += F.w * dt;
  h.x += Math.cos(F.th) * F.v * dt; h.y += Math.sin(F.th) * F.v * dt;
  if (!goal) { h.x = clamp(h.x, 16, W - 16); h.y = clamp(h.y, 16, H - 16); }
}
function paintFish(F, i, fs) {                     // place every segment: position, direction of travel, thickness, plus a little tail wiggle
  const p = F.p, cs = fishCoils[i], bs = SW.base[i];
  for (let k = 0; k <= HEAD; k++) {
    const a = p[Math.min(k + 1, HEAD)], b = p[Math.max(k - 1, 0)], ang = Math.atan2(a.y - b.y, a.x - b.x);
    const o = Math.sin(F.ph - k * .55) * F.amp * 3.2 * fs * Math.pow(1 - k / HEAD, 1.2);
    const x = p[k].x - Math.sin(ang) * o, y = p[k].y + Math.cos(ang) * o;
    cs[k].style.transform = `translate(${(x - bs.x).toFixed(2)}px,${(y - bs.y).toFixed(2)}px) rotate(${ang.toFixed(3)}rad) scale(${(SCALE_ME[k] * fs).toFixed(3)})`;
  }
  fishEls[i].style.filter = `drop-shadow(${(56 * fs).toFixed(1)}px ${(4.7 * fs).toFixed(1)}px ${(5 * fs).toFixed(1)}px rgba(0,0,0,.3))`;   // the same shadow as the CSS, scaled with the fish
}
function swimStep(now) {
  swimRaf = requestAnimationFrame(swimStep);
  if (!SW) return;
  const dt = clamp((now - SW.last) / 1000, 0, .05); SW.last = now;
  const W = innerWidth, H = innerHeight, spots = fstate === 'roam' ? null : fishRestSpots();
  SW.fs += (SW.fsT - SW.fs) * (1 - Math.exp(-dt * 3));
  const fs = SW.fs; let worst = 0, arrived = true, calm = true;
  SW.fish.forEach((F, i) => {
    const p = F.p;
    if (fstate === 'settle' && spots) {            // glide every segment into the resting pose
      const k = 1 - Math.exp(-dt * 8);
      p.forEach((q, j) => {
        const tx = spots[i][0] + fShape[i][j][0], ty = spots[i][1] + fShape[i][j][1];
        q.x += (tx - q.x) * k; q.y += (ty - q.y) * k; worst = Math.max(worst, Math.hypot(tx - q.x, ty - q.y));
      });
      F.amp += (0 - F.amp) * (1 - Math.exp(-dt * 8)); if (F.amp > .05) calm = false;
    } else {
      const goal = fstate === 'back' && spots ? { x: spots[i][0] + fShape[i][HEAD][0], y: spots[i][1] + fShape[i][HEAD][1] } : null;
      steer(F, dt, W, H, goal);
      const d = F.d * fs;                          // body: every segment stays one step behind the one in front of it
      for (let k = HEAD - 1; k >= 0; k--) {
        const a = p[k + 1], b = p[k]; let dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
        if (l < 1e-6) { dx = -Math.cos(F.th); dy = -Math.sin(F.th); l = 1; }
        b.x = a.x + dx / l * d; b.y = a.y + dy / l * d;
      }
      F.amp += (1 - F.amp) * (1 - Math.exp(-dt * 2));
      F.ph += dt * (4 + F.v / 30);
      if (F.dist > 16) arrived = false;
    }
    paintFish(F, i, fs);
  });
  if (fstate === 'back') {
    SW.backT += dt;
    if (!spots) return;
    if (arrived || SW.backT > 9) { fstate = 'settle'; SW.settleT = 0; }
  } else if (fstate === 'settle') {
    SW.settleT += dt;
    if (!spots || (worst < .35 && Math.abs(fs - REST_S) < .004 && calm) || SW.settleT > 2.5) fishSettled();
  }
}
function fishSettled() {                           // hand the fish back to the CSS resting pose
  cancelAnimationFrame(swimRaf); swimRaf = 0; SW = null;
  fishCoils.forEach(cs => cs.forEach(c => { c.style.transform = ''; c.style.offsetPath = ''; }));
  fishEls.forEach(f => { f.style.filter = ''; });
  fstate = 'rest'; fC = []; fishCentres(); layoutFish();
}

pond.addEventListener('click', e => {
  if (!e.target.closest('.koiCoil')) return;
  if (fstate === 'rest') fishOut();
  else if (fstate === 'roam') fishBack();
  else if (fstate === 'back') { fstate = 'roam'; SW.fsT = 1; }   // tapped again on the way home: swim off again
});
addEventListener('scroll', queueFish, { passive: true });
addEventListener('resize', () => { if (fstate === 'rest') { fC = []; queueFish(); } });
(function startFish() {
  if (!fishCoils.every(cs => cs.length === HEAD + 1 && cs.every(c => c.getAnimations().some(a => a.animationName === 'fishAnim')))) return;   // the browser can't run them: leave the fish hidden
  fishCentres(); layoutFish();
  [300, 900, 1600, 2600].forEach(t => setTimeout(() => { if (fstate === 'rest') { fC = []; layoutFish(); } }, t));   // re-place once the cards have finished sliding in and fonts have loaded
  addEventListener('load', () => { if (fstate === 'rest') { fC = []; queueFish(); } });
  if (window.ResizeObserver) new ResizeObserver(() => { if (fstate === 'rest') { fC = []; queueFish(); } }).observe($('.dash'));
})();
