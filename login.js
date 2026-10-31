'use strict';
/* =====================================================================
   LOGIN SCREEN - loads after app.js (it uses the API address and the koi functions defined there)
   - the password is NOT in this file: it is checked by Code.gs against the "Password" tab of the sheet
   - nothing is remembered: every page load / refresh asks for the password again
   ===================================================================== */
(function () {
  const box = document.getElementById('login');
  if (!box) return;
  const form = document.getElementById('lgForm'), input = document.getElementById('lgPass'), msg = document.getElementById('lgMsg'),
        btn = document.getElementById('lgBtn'), eye = document.getElementById('lgEye');
  const calm = matchMedia('(prefers-reduced-motion:reduce)').matches;
  let busy = false, done = false;

  const say = t => { msg.textContent = t; };
  function shake() {
    form.classList.remove('bad'); void form.offsetWidth; form.classList.add('bad');
    setTimeout(() => form.classList.remove('bad'), 500);
  }

  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', show ? 'true' : 'false');
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });

  /* The koi rest beside the cow, and their spot is worked out from where the cow is at that moment.
     While the cards are still sliding in, the cow is shifted to the right, so the fish would end up on top of it.
     So: keep the fish hidden, wait until the cow's slide-in has finished, place them beside it, then fade them in. */
  function placeKoi() {
    try { if (typeof fstate !== 'undefined' && fstate === 'rest') { fC = []; layoutFish(); } } catch (err) {}
    document.body.classList.remove('pondwait');
  }
  function koiAfterSlide() {
    const card = document.querySelector('.qwrap'); let fired = false;
    const go = () => { if (fired) return; fired = true; if (card) card.removeEventListener('animationend', onEnd); setTimeout(placeKoi, 60); };
    const onEnd = e => { if (e.target === card && e.animationName === 'cardIn') go(); };
    if (card && !calm) card.addEventListener('animationend', onEnd);
    setTimeout(go, calm ? 100 : 2600);                                              // safety net if the event never arrives
  }

  function unlock() {
    done = true; input.value = ''; input.type = 'password'; input.blur(); say('');
    document.body.classList.add('pondwait');
    box.classList.add('out');                                                        // glass box slides out, then the pink picture
    setTimeout(() => { document.body.classList.remove('locked'); koiAfterSlide(); }, calm ? 0 : 380);   // dashboard cards slide in with their normal entrance
    setTimeout(() => { box.hidden = true; }, calm ? 400 : 1300);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || done) return;
    const pw = input.value;
    if (!pw.trim()) { say('Type the password first.'); shake(); input.focus(); return; }
    busy = true; btn.disabled = true; btn.textContent = 'Checking…'; say('');
    try {
      if (typeof API === 'string' && API) {
        const r = await (await fetch(API, { method: 'POST', body: JSON.stringify({ action: 'login', password: pw }) })).json();
        if (r.error) throw new Error(r.error);
        if (r.login === true) { unlock(); return; }
        if (r.login !== false) throw new Error('outdated');                         // an old Code.gs would answer "ok" without checking
        say('Wrong password. Try again.'); shake(); input.select();
      } else unlock();                                                              // demo mode (no sheet connected): nothing to check against
    } catch (err) {
      say(/outdated/.test(err.message) ? 'Redeploy the new Code.gs.' : 'Could not check the password. Check your connection.');
    } finally {
      if (!done) { busy = false; btn.disabled = false; btn.textContent = 'Enter'; }
    }
  });

  setTimeout(() => { if (!done) input.focus(); }, 300);
})();
