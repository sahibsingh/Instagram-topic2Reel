/* Wiring for the prompt builder and the template gallery. Logic lives in builder.js (T2R).
   User text is only ever written with textContent / value, never innerHTML. */
(function () {
  'use strict';
  var T = window.T2R;
  if (!T) return;
  var $ = function (id) { return document.getElementById(id); };
  var tab = 'plugin';
  var filter = 'All';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  /* ---------- build the controls ---------- */
  function seg(groupId, name, options, onPick) {
    var box = $(groupId);
    Object.keys(options).forEach(function (key) {
      var o = options[key], id = name + '-' + key;
      var input = el('input', { type: 'radio', name: name, id: id, value: key });
      var label = el('label', { for: id }, [el('span', { text: o.label || o }), o.hint ? el('small', { text: o.hint }) : document.createTextNode('')]);
      input.addEventListener('change', onPick);
      box.appendChild(input); box.appendChild(label);
    });
  }
  function toObj(list) { var o = {}; list.forEach(function (v) { o[v] = { label: v.charAt(0).toUpperCase() + v.slice(1) }; }); return o; }

  seg('g-length', 'length', T.LENGTHS, update);
  seg('g-tone', 'tone', toObj(T.TONES), update);
  seg('g-hook', 'hook', T.HOOKS, update);
  seg('g-cta', 'cta', T.CTAS, update);
  T.MID_TYPES.forEach(function (t) {
    var id = 'sc-' + t.id, input = el('input', { type: 'checkbox', id: id, value: t.id });
    input.addEventListener('change', update);
    $('g-scenes').appendChild(input);
    $('g-scenes').appendChild(el('label', { for: id }, [el('span', { text: t.label }), el('small', { text: t.hint })]));
  });
  Object.keys(T.VOICES).forEach(function (k) { $('f-voice').appendChild(el('option', { value: k, text: T.VOICES[k] })); });
  ['f-topic', 'f-audience', 'f-facts', 'f-avoid'].forEach(function (id) { $(id).addEventListener('input', update); });
  ['f-voice', 'f-lexicon', 'f-preview', 'f-install'].forEach(function (id) { $(id).addEventListener('change', update); });

  /* ---------- form <-> state ---------- */
  function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : undefined; }
  function readForm() {
    return T.normalize({
      topic: $('f-topic').value, audience: $('f-audience').value, tone: radio('tone'), length: radio('length'),
      scenes: Array.prototype.map.call(document.querySelectorAll('#g-scenes input:checked'), function (i) { return i.value; }),
      hook: radio('hook'), cta: radio('cta'), voice: $('f-voice').value, lexicon: $('f-lexicon').checked,
      preview: $('f-preview').checked, install: $('f-install').checked, facts: $('f-facts').value, avoid: $('f-avoid').value
    });
  }
  function writeForm(raw) {
    var st = T.normalize(raw);
    $('f-topic').value = st.topic; $('f-audience').value = st.audience;
    ['tone', 'length', 'hook', 'cta'].forEach(function (n) { var r = $(n + '-' + st[n]); if (r) r.checked = true; });
    T.MID_TYPES.forEach(function (t) { $('sc-' + t.id).checked = st.scenes.indexOf(t.id) !== -1; });
    $('f-voice').value = st.voice; $('f-lexicon').checked = st.lexicon; $('f-preview').checked = st.preview; $('f-install').checked = st.install;
    $('f-facts').value = st.facts; $('f-avoid').value = st.avoid;
    update();
  }

  /* ---------- output ---------- */
  function currentPrompt(st) { return tab === 'cloud' ? T.cloudPrompt(st) : T.pluginPrompt(st); }

  function update() {
    var st = readForm(), errs = T.problems(st), ok = errs.length === 0;
    var text = currentPrompt(st);
    $('o-prompt').textContent = text;
    $('e-topic').hidden = st.topic.length >= 3;
    $('e-scenes').hidden = st.scenes.length > 0;
    var notes = $('o-notes'); notes.textContent = '';
    (ok ? T.notes(st) : errs).forEach(function (n) { notes.appendChild(el('li', { text: n })); });
    $('b-copy').disabled = !ok; $('b-share').disabled = !ok;
    var open = $('a-open'); open.hidden = tab !== 'cloud';
    if (ok) { open.setAttribute('href', T.openInClaudeUrl(T.cloudPrompt(st))); open.removeAttribute('aria-disabled'); }
    else { open.setAttribute('href', '#builder'); open.setAttribute('aria-disabled', 'true'); }
    $('o-hint').textContent = tab === 'cloud'
      ? 'For Claude in the cloud or any session. It works with or without the plugin installed.'
      : 'For Claude Code with the topic2reel plugin installed. Paste it as one message.';
    $('o-meta').textContent = text.split(/\s+/).filter(Boolean).length + ' words, ' + text.length + ' characters';
    document.querySelectorAll('[role="tab"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    try { var u = new URL(location.href); u.searchParams.set('b', JSON.stringify(st)); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) { /* file:// or blocked: ignore */ }
  }

  function copy(text, button) {
    var done = function () { var old = button.dataset.label || button.textContent; button.dataset.label = old; button.textContent = 'Copied'; setTimeout(function () { button.textContent = old; }, 1400); };
    try { navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); }); } catch (e) { fallback(text, done); }
  }
  function fallback(text, done) {
    var ta = el('textarea', { 'aria-hidden': 'true' }); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* user can select the text by hand */ } document.body.removeChild(ta);
  }

  $('b-copy').addEventListener('click', function () { copy($('o-prompt').textContent, $('b-copy')); });
  $('b-share').addEventListener('click', function () { copy(location.href, $('b-share')); });
  $('b-reset').addEventListener('click', function () { writeForm(T.DEFAULTS); });
  document.querySelectorAll('[role="tab"]').forEach(function (b) { b.addEventListener('click', function () { tab = b.dataset.tab; update(); }); });

  /* ---------- templates ---------- */
  function renderTemplates() {
    var chips = $('t-filter'); chips.textContent = '';
    ['All'].concat(T.categories()).forEach(function (c) {
      var b = el('button', { type: 'button', class: 'chipbtn', 'aria-pressed': String(c === filter), text: c });
      b.addEventListener('click', function () { filter = c; renderTemplates(); });
      chips.appendChild(b);
    });
    var grid = $('t-grid'); grid.textContent = '';
    T.TEMPLATES.filter(function (t) { return filter === 'All' || t.category === filter; }).forEach(function (t) {
      var st = T.normalize(t.s);
      var tags = ['hook'].concat(st.scenes).concat(['cta']).map(function (s) { return el('span', { class: 'tag', text: s }); });
      var use = el('button', { type: 'button', class: 'btn small', text: 'Use in builder' });
      var cp = el('button', { type: 'button', class: 'btn ghost small', text: 'Copy prompt' });
      use.addEventListener('click', function () { writeForm(t.s); $('builder').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('f-topic').focus({ preventScroll: true }); });
      cp.addEventListener('click', function () { copy(currentPrompt(st), cp); });
      grid.appendChild(el('article', { class: 'tcard' }, [
        el('span', { class: 'cat', text: t.category }), el('h3', { text: t.title }), el('p', { text: t.blurb }),
        el('div', { class: 'tags' }, tags), el('div', { class: 'tact' }, [use, cp])
      ]));
    });
  }

  /* ---------- start: share link first, then defaults ---------- */
  var start = T.DEFAULTS;
  try { var q = new URLSearchParams(location.search).get('b'); if (q) start = JSON.parse(q); } catch (e) { start = T.DEFAULTS; }
  renderTemplates();
  writeForm(start);
})();
