/* Small, self-contained product experiences. No network requests or stored user data. */
(() => {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const project = JSON.parse(document.querySelector('#demo-project').textContent);
  const page = document.querySelector('.try-page');
  const body = page.querySelector('.try-body');
  let cleanup;
  const pressed = (buttons, selected) => buttons.forEach(b => b.setAttribute('aria-pressed', String(b === selected)));
  const shell = (kind, html) => { body.innerHTML = `<section class="product-demo pd-${kind}" aria-label="${escape(project.name)} demo">${html}</section>`; };
  const external = (label, href) => `<a class="pd-button" href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`;
  const renderers = {
dictation() {
      const samples = [
        { raw: 'um so like the new schedule page is ready uh take a look when you get a chance', casual: 'The new schedule page is ready. Take a look when you get a chance!', email: 'The new schedule page is ready for your review. Please take a look when you have a moment.' },
        { raw: 'okay so we need to um update the photos and then check the mobile layout and uh send the preview', casual: 'We need to update the photos, check the mobile layout, and send the preview.', email: 'Our next steps are to update the photos, check the mobile layout, and send the preview.' }
      ];
      let selected = 0, tone = 'casual', complete = false, timers = [];
      const clear = () => { timers.forEach(clearTimeout); timers = []; };
      shell('dictation', `<span class="pd-kicker">Dictation Operative / From thought to text</span><h2>Say it once. Keep moving.</h2><p class="pd-lede">Play a sample to see speech become clean text, ready for the app you’re in.</p><div class="pd-split"><div class="pd-panel"><label class="pd-field">Sample phrase<select aria-label="Sample phrase"><option value="0">A quick project update</option><option value="1">The next steps</option></select></label><p class="dict-source"></p><div class="dict-wave" aria-hidden="true">${Array.from({ length: 23 }, (_, i) => `<i style="--bar:${10 + (i * 17 % 27)}px;--delay:${i * 30}ms"></i>`).join('')}</div><button type="button" class="pd-button dict-play">▶ Play sample</button><p class="pd-status dict-status" role="status">Simulation · No microphone needed.</p></div><div><div class="pd-options" role="group" aria-label="Destination tone"><button type="button" aria-pressed="true" data-tone="casual">Chat · Casual</button><button type="button" aria-pressed="false" data-tone="email">Mail · Polished</button></div><div class="dict-window"><div class="dict-chrome"><i></i><i></i><i></i><span class="dict-app">Team chat / Draft message</span></div><div class="dict-document"><span class="pd-kicker">At your cursor</span><blockquote class="dict-output" aria-live="polite">Your words land here.</blockquote></div></div><p class="pd-note" style="margin-top:14px">This preview uses scripted text. The Mac app transcribes on-device; optional AI cleanup uses your chosen provider.</p></div></div>`);
      const play = body.querySelector('.dict-play'), output = body.querySelector('.dict-output'), status = body.querySelector('.dict-status'), wave = body.querySelector('.dict-wave'), select = body.querySelector('select');
      const paintSource = () => { body.querySelector('.dict-source').textContent = `“${samples[selected].raw}”`; };
      const finish = () => { complete = true; output.textContent = samples[selected][tone]; status.textContent = '✓ Filler removed. Punctuation added. Ready at your cursor.'; play.textContent = '↻ Play again'; play.disabled = false; select.disabled = false; wave.classList.remove('playing'); };
      const toneButtons = body.querySelectorAll('[data-tone]');
      toneButtons.forEach(b => b.addEventListener('click', () => { tone = b.dataset.tone; pressed(toneButtons, b); body.querySelector('.dict-app').textContent = tone === 'casual' ? 'Team chat / Draft message' : 'Mail / Draft email'; if (complete) output.textContent = samples[selected][tone]; }));
      select.addEventListener('change', () => { clear(); selected = +select.value; complete = false; paintSource(); output.textContent = 'Your words land here.'; status.textContent = 'Simulation · No microphone needed.'; play.textContent = '▶ Play sample'; });
      play.addEventListener('click', () => {
        clear(); complete = false; play.disabled = true; select.disabled = true; play.textContent = 'Playing sample…'; status.textContent = '1 / 3 · Listening to the sample'; wave.classList.add('playing'); output.textContent = 'Listening…';
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
        timers.push(setTimeout(() => { output.textContent = samples[selected].raw; status.textContent = '2 / 3 · Transcript captured. Cleaning up…'; }, 900));
        timers.push(setTimeout(finish, 2100));
      });
      paintSource();
      return clear;
    }
};
  const render = () => {
    if (cleanup) cleanup();
    cleanup = renderers[project.demo]();
  };
  page.querySelector('.try-reset').addEventListener('click', () => {
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  window.addEventListener('pagehide', () => { if (cleanup) cleanup(); });
  // A restored back/forward-cache page must not retain a half-finished simulation.
  window.addEventListener('pageshow', e => { if (e.persisted) render(); });
  render();
})();
