'use strict';

const $ = id => document.getElementById(id);
const phaseNames = {write: 'Write', mask: 'Mask', guess: 'Guess'};
const store = {
  get(key) { try { return localStorage.getItem(`nutshell:${key}`); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(`nutshell:${key}`, value); } catch {} },
  remove(key) { try { localStorage.removeItem(`nutshell:${key}`); } catch {} }
};
let room = null, token = '', roomCode = '', offset = 0, stageKey = '';
let queue = Promise.resolve(), pending = 0, pollTimer, draftTimer, settingsTimer, toastTimer;
let localVisible = [], dirty = false, settingsDirty = false, entryBusy = false;

function notify(message, persistent = false) {
  clearTimeout(toastTimer);
  $('notice').textContent = message;
  $('notice').hidden = !message;
  if (!persistent) toastTimer = setTimeout(() => { $('notice').hidden = true; }, 4500);
}
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, action, className = '') {
  const el = element('button', text, className);
  el.type = 'button';
  el.addEventListener('click', action);
  return el;
}
function playerName(id) { return room.players.find(p => p.id === id)?.name || 'A friend'; }
function actorName(phase) { return playerName(room.roles[phase]); }

// Adapted from UI.md / soroban's NumSlider: vertical only, start-anchored,
// snapped updates, pointer capture, plus keyboard access to every duration.
class NumSlider {
  constructor(phase, initial) {
    this.value = initial;
    this.phase = phase;
    this.drag = null;
    this.label = element('label', undefined, 'drag-number-control');
    this.label.append(element('span', phaseNames[phase]));
    this.num = button('', () => {}, 'drag-number-value');
    this.num.setAttribute('role', 'slider');
    this.num.setAttribute('aria-label', `${phaseNames[phase]} phase seconds`);
    this.num.setAttribute('aria-orientation', 'vertical');
    this.num.setAttribute('aria-valuemin', '5');
    this.num.setAttribute('aria-valuemax', '300');
    this.num.title = 'Drag up / down; arrow keys change 5 seconds';
    this.label.append(this.num);
    this.set(initial);
    this.num.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.num.disabled) return;
      this.drag = {y: event.clientY, value: this.value, id: event.pointerId};
      this.num.setPointerCapture(event.pointerId);
      this.num.classList.add('dragging');
      event.preventDefault();
    });
    this.num.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      // Four vertical pixels per 5 seconds; horizontal movement has no effect.
      this.set(this.drag.value + Math.round((this.drag.y - event.clientY) / 4) * 5, true);
    });
    const end = event => {
      if (!this.drag || (event.pointerId !== undefined && event.pointerId !== this.drag.id)) return;
      this.drag = null;
      this.num.classList.remove('dragging');
      if (event.pointerId !== undefined && this.num.hasPointerCapture(event.pointerId)) this.num.releasePointerCapture(event.pointerId);
      if (settingsDirty) saveSettings();
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.num.addEventListener(name, end);
    this.num.addEventListener('keydown', event => {
      const changes = {ArrowUp: 5, ArrowDown: -5, ArrowRight: 5, ArrowLeft: -5, PageUp: 30, PageDown: -30};
      if (event.key === 'Home' || event.key === 'End' || event.key in changes) {
        event.preventDefault();
        this.set(event.key === 'Home' ? 5 : event.key === 'End' ? 300 : this.value + changes[event.key], true);
      }
    });
    this.num.addEventListener('input', () => {
      settingsDirty = true;
      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(saveSettings, 400);
    });
  }
  set(raw, emit = false) {
    const next = Math.max(5, Math.min(300, Math.round(Number(raw) / 5) * 5));
    const changed = next !== this.value;
    this.value = next;
    this.num.dataset.value = String(next);
    this.num.textContent = String(next);
    this.num.setAttribute('aria-valuenow', String(next));
    this.num.setAttribute('aria-valuetext', `${next} seconds`);
    if (emit && changed) this.num.dispatchEvent(new Event('input', {bubbles: true}));
  }
}
const sliders = Object.fromEntries(Object.entries({write: 60, mask: 30, guess: 30}).map(([phase, value]) => {
  const control = new NumSlider(phase, value);
  $('duration-controls').append(control.label);
  return [phase, control];
}));

async function request(action, data = {}, credentials = {code: roomCode, token}) {
  const started = Date.now();
  const options = {cache: 'no-store', signal: AbortSignal.timeout(12000), headers: {'X-Nutshell-Token': credentials.token}};
  let url = `api.php?room=${encodeURIComponent(credentials.code)}`;
  if (action !== 'state') {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({action, room: credentials.code, ...data});
    url = 'api.php';
  }
  const response = await fetch(url, options);
  let result;
  try { result = await response.json(); } catch { throw new Error('The room server is not responding. Please try again.'); }
  if (!response.ok) {
    const error = new Error(result.error || 'That did not go through. Try again.');
    error.status = response.status;
    throw error;
  }
  if (result.room) offset = result.room.serverTime * 1000 - (started + Date.now()) / 2;
  return result;
}
function accept(next) {
  if (room && next.code === room.code && next.version < room.version) return;
  room = next;
  $('connection').textContent = 'Connected';
  render();
}
function mutate(action, payload = {}) {
  const expected = room ? {round: room.round, phase: room.phase} : {};
  pending++;
  const operation = queue.catch(() => {}).then(async () => {
    const result = await request(action, {...expected, ...payload});
    if (result.room) accept(result.room);
    return result;
  });
  queue = operation;
  return operation.catch(error => {
    $('save-state').textContent = 'Not saved — try again';
    notify(error.message);
    throw error;
  }).finally(() => { pending--; });
}
async function poll() {
  clearTimeout(pollTimer);
  if (!roomCode || !token) return;
  try {
    if (!pending) accept((await request('state')).room);
  } catch (error) {
    $('connection').textContent = 'Reconnecting…';
    if (error.status === 401 || error.status === 404) {
      exitRoom();
      notify(error.message, true);
      return;
    }
  }
  pollTimer = setTimeout(poll, document.hidden ? 2500 : 1000);
}
function payloadFromInputs() {
  if (room?.phase === 'write') return {question: $('question')?.value || '', answer: $('answer')?.value || ''};
  if (room?.phase === 'mask') return {visible: [...localVisible]};
  if (room?.phase === 'guess') return {guess: $('guess')?.value || ''};
  return {};
}
function scheduleDraft() {
  dirty = true;
  $('save-state').textContent = 'Saving…';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 220);
}
async function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = null;
  if (!dirty || !room || room.phase !== room.role) return;
  const payload = payloadFromInputs();
  dirty = false;
  try {
    await mutate('draft', payload);
    if (!dirty) $('save-state').textContent = 'Saved';
  } catch { if (room && room.phase === room.role) dirty = true; }
}
async function saveSettings() {
  clearTimeout(settingsTimer);
  if (!settingsDirty || !room || room.you !== room.host) return;
  settingsDirty = false;
  const settings = Object.fromEntries(Object.entries(sliders).map(([key, slider]) => [key, slider.value]));
  try { await mutate('settings', {settings}); } catch { settingsDirty = true; }
}
async function startRound() {
  await saveSettings();
  if (settingsDirty) return;
  try { await mutate('start'); } catch {}
}
async function submitPhase(event) {
  event?.preventDefault();
  clearTimeout(draftTimer);
  dirty = false;
  const payload = payloadFromInputs();
  const submit = $('phase-submit');
  if (submit) submit.disabled = true;
  try { await mutate('submit', payload); }
  catch { if (submit?.isConnected) submit.disabled = false; }
}
async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); notify(message); }
  catch { notify(`Copy this: ${text}`, true); }
}
function clueText() {
  const visible = room.role === 'mask' && room.phase === 'mask' ? localVisible : room.visible;
  return room.words.map((word, i) => visible[i] && word !== null ? word : '🟦').join(' ');
}
function inputField(form, id, label, placeholder, value, multiline = false) {
  const group = element('div', undefined, 'field-group');
  const labelEl = element('label', label);
  labelEl.htmlFor = id;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.id = id;
  input.value = value || '';
  input.placeholder = placeholder;
  input.maxLength = id === 'question' ? 400 : 200;
  input.autocomplete = 'off';
  input.required = true;
  input.addEventListener('input', scheduleDraft);
  group.append(labelEl, input);
  form.append(group);
  return input;
}
function renderClue(editable = false) {
  const clue = $('clue');
  if (!clue) return;
  const flags = editable ? localVisible : room.visible;
  if (editable && clue.children.length === room.words.length) {
    [...clue.children].forEach((tile, i) => {
      tile.classList.toggle('chosen', flags[i]);
      tile.setAttribute('aria-pressed', String(flags[i]));
      tile.setAttribute('aria-label', `${flags[i] ? 'Hide' : 'Reveal'} ${room.words[i]}`);
    });
  } else {
    clue.replaceChildren();
    room.words.forEach((word, i) => {
      let tile;
      if (editable) {
        tile = button(word, () => {
          if (Date.now() + offset >= room.deadline * 1000) return;
          localVisible[i] = !localVisible[i];
          renderClue(true);
          scheduleDraft();
        }, `word${flags[i] ? ' chosen' : ''}`);
        tile.setAttribute('aria-pressed', String(flags[i]));
        tile.setAttribute('aria-label', `${flags[i] ? 'Hide' : 'Reveal'} ${word}`);
      } else {
        const shown = flags[i] && word !== null;
        tile = element('span', shown ? word : '', `word ${shown ? 'chosen' : 'blank'}`);
        if (!shown) tile.setAttribute('aria-label', 'Hidden word');
      }
      clue.append(tile);
    });
  }
  const count = flags.filter(Boolean).length;
  if ($('word-count')) $('word-count').textContent = `${count} of ${flags.length} words visible`;
  if (editable && $('phase-submit')) $('phase-submit').disabled = count === 0;
}
function render() {
  $('entrance').hidden = true;
  $('game').hidden = false;
  $('room-tools').hidden = false;
  $('room-code').textContent = room.code;
  $('round-label').textContent = room.round ? `Round ${room.round}` : `${room.players.length} / 3 players`;
  const assigned = room.phase === 'lobby' ? Object.fromEntries(['write', 'mask', 'guess'].map((p, i) => [p, room.players[i]?.id])) : room.roles;
  $('seats').replaceChildren();
  for (const phase of ['write', 'mask', 'guess']) {
    const id = assigned[phase];
    const seat = element('div', undefined, `seat${room.phase === phase ? ' active' : ''}`);
    seat.append(element('div', phaseNames[phase], 'seat-role'));
    const name = element('div', id ? playerName(id) : 'Open seat', `seat-name${id ? '' : ' empty-seat'}`);
    if (id === room.you) name.append(element('small', 'you'));
    seat.append(name);
    $('seats').append(seat);
  }
  for (const [phase, slider] of Object.entries(sliders)) {
    if (!settingsDirty && !slider.drag && !pending) slider.set(room.settings[phase]);
    slider.num.disabled = room.host !== room.you;
  }
  $('settings-note').textContent = room.host !== room.you ? 'Host controls timers' : room.deadline ? 'Changes apply next round' : 'Drag up or down';
  const key = `${room.round}:${room.phase}:${room.role}:${room.outcome}:${room.players.length}:${room.host}`;
  if (key !== stageKey) {
    stageKey = key;
    clearTimeout(draftTimer);
    dirty = false;
    $('save-state').textContent = '';
    localVisible = [...room.visible];
    buildStage();
  } else if (room.phase === 'mask' && room.role === 'mask') {
    if (!dirty && !pending) localVisible = [...room.visible];
    renderClue(true);
  } else if (room.phase === 'guess') renderClue();
  tick();
}
function buildStage() {
  const body = $('stage-body');
  body.replaceChildren();
  const mine = room.phase === room.role;
  const title = $('stage-title'), kicker = $('phase-kicker');
  if (room.phase === 'lobby') {
    kicker.textContent = 'GET TOGETHER';
    title.textContent = room.players.length === 3 ? 'Everyone’s here.' : 'Waiting for your friends.';
    body.append(element('p', 'Share the invite with two friends. You’ll each write, mask, and guess as the roles rotate.', 'waiting'));
    const actions = element('div', undefined, 'actions');
    if (room.host === room.you) {
      const start = button('Start round', startRound, 'primary');
      start.disabled = room.players.length !== 3;
      actions.append(start);
    } else actions.append(element('p', 'The host will start the round.', 'fine'));
    actions.append(button('Copy invite', () => copyInvite()));
    body.append(actions);
  } else if (room.phase === 'write') {
    kicker.textContent = '01 / WRITE';
    title.textContent = mine ? 'Set the question.' : `${actorName('write')} is writing.`;
    if (mine) {
      const form = document.createElement('form');
      form.addEventListener('submit', submitPhase);
      inputField(form, 'question', 'Question', 'Which planet in our solar system is famous for its rings?', room.question, true);
      inputField(form, 'answer', 'Answer', 'Saturn', room.answer);
      const actions = element('div', undefined, 'actions');
      const submit = element('button', 'Send to masker', 'primary'); submit.id = 'phase-submit'; submit.type = 'submit';
      actions.append(submit, element('span', '2–40 words · Draft autosaves', 'fine'));
      form.append(actions); body.append(form);
    } else body.append(element('p', 'The question and answer are private until the next phase. Get ready.', 'waiting'));
  } else if (room.phase === 'mask') {
    kicker.textContent = '02 / MASK';
    title.textContent = mine ? 'How little is enough?' : `${actorName('mask')} is choosing the clue.`;
    if (mine) {
      body.append(element('p', 'Tap the words to keep. Everything else stays hidden.', 'waiting'));
      const answer = element('p', 'Answer: ', 'answer-line'); answer.append(element('strong', room.answer)); body.append(answer);
      const clue = element('div', undefined, 'clue'); clue.id = 'clue'; body.append(clue);
      const actions = element('div', undefined, 'actions');
      const submit = button('Lock clue', submitPhase, 'primary'); submit.id = 'phase-submit';
      const count = element('span', '', 'fine'); count.id = 'word-count';
      actions.append(submit, count); body.append(actions);
      renderClue(true);
    } else if (room.role === 'write') {
      body.append(element('p', room.question, 'reveal-question'));
      body.append(element('p', `Answer: ${room.answer}`, 'answer-line'));
      body.append(element('p', 'Let the masker do their thing.', 'waiting'));
    } else body.append(element('p', 'Your clue is still under wraps. The guess timer starts when it’s ready.', 'waiting'));
  } else if (room.phase === 'guess') {
    kicker.textContent = '03 / GUESS';
    title.textContent = mine ? 'Crack the clue.' : `${actorName('guess')} is thinking.`;
    const clue = element('div', undefined, 'clue'); clue.id = 'clue'; body.append(clue);
    const count = element('p', '', 'fine'); count.id = 'word-count'; body.append(count); renderClue();
    if (mine) {
      const form = document.createElement('form'); form.addEventListener('submit', submitPhase); form.style.marginTop = '1.5rem';
      inputField(form, 'guess', 'Your answer', 'Take your best shot…', room.guess);
      const submit = element('button', 'Lock answer', 'primary'); submit.id = 'phase-submit'; submit.type = 'submit'; form.append(submit); body.append(form);
    } else {
      body.append(element('p', `Answer: ${room.answer}`, 'answer-line'));
      body.append(element('p', 'No hints! Wait for the guess.', 'fine'));
    }
    const actions = element('div', undefined, 'actions');
    actions.append(button('Copy for Discord', () => copy(clueText(), 'Masked clue copied.'))); body.append(actions);
  } else {
    kicker.textContent = 'THE REVEAL';
    title.textContent = room.outcome === true ? 'Cracked it.' : room.outcome === false ? 'That was a tough nut.' : 'Did they get it?';
    body.append(element('p', room.question || 'No question submitted.', 'reveal-question'));
    body.append(element('div', room.answer || '—', 'reveal-answer'));
    const guess = element('p', `${actorName('guess')} guessed: `, 'guess-line'); guess.append(element('strong', room.guess || 'No answer')); body.append(guess);
    body.append(element('p', room.reason, 'fine'));
    const judge = room.you === room.host || room.role === 'write';
    const actions = element('div', undefined, 'actions');
    if (room.outcome === null) {
      if (judge) actions.append(button('Correct', () => mutate('judge', {correct: true}).catch(() => {}), 'primary'), button('Missed', () => mutate('judge', {correct: false}).catch(() => {})));
      else actions.append(element('p', 'The writer will mark the answer.', 'fine'));
    } else {
      body.append(element('p', room.outcome ? 'Correct answer' : 'Round missed', `outcome${room.outcome ? '' : ' missed'}`));
      if (judge) {
        const next = button('Next round · switch roles', startRound, 'primary');
        next.disabled = room.players.length !== 3;
        actions.append(next);
        if (room.players.length !== 3) actions.append(element('span', 'Invite a third player to continue.', 'fine'));
      } else actions.append(element('p', 'Waiting for the next round.', 'fine'));
    }
    body.append(actions);
  }
}
function tick() {
  if (!room) return;
  const timed = room.deadline !== null;
  $('clock').hidden = $('time-track').hidden = !timed;
  if (!timed) return;
  const remaining = Math.max(0, room.deadline - (Date.now() + offset) / 1000);
  const seconds = Math.ceil(remaining);
  $('clock').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('urgent', remaining <= 5);
  $('time-fill').style.transform = `scaleX(${Math.min(1, remaining / room.durations[room.phase])})`;
  if (remaining < .7 && dirty && draftTimer) saveDraft();
}
async function copyInvite() {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', room.code);
  await copy(url.href, 'Invite copied. Send it to two friends.');
}
function exitRoom(clear = true) {
  if (clear && roomCode) store.remove(`seat:${roomCode}`);
  clearTimeout(pollTimer); clearTimeout(draftTimer); clearTimeout(settingsTimer);
  room = null; token = ''; roomCode = ''; stageKey = ''; dirty = settingsDirty = false;
  $('entrance').hidden = false; $('game').hidden = $('room-tools').hidden = true;
  history.replaceState({}, '', location.pathname);
  $('join-code').value = ''; updateEntry();
}
function updateEntry() {
  const joining = Boolean($('join-code').value.trim());
  $('entry-submit').textContent = joining ? 'Join room' : 'Create room';
  $('entry-title').textContent = joining ? 'Your friends are waiting.' : 'Bring your people.';
}
async function enter(name, code = '') {
  if (entryBusy) return;
  entryBusy = true; $('entry-submit').disabled = true;
  try {
    const result = await request(code ? 'join' : 'create', {name}, {code: code.toUpperCase(), token: ''});
    token = result.token; roomCode = result.room.code;
    store.set('name', name); store.set(`seat:${roomCode}`, token);
    history.replaceState({}, '', `${location.pathname}?room=${roomCode}`);
    accept(result.room); poll();
    return {room: roomCode, role: result.room.role};
  } catch (error) { notify(error.message, true); throw error; }
  finally { entryBusy = false; $('entry-submit').disabled = false; }
}
$('entry-form').addEventListener('submit', event => { event.preventDefault(); enter($('name').value.trim(), $('join-code').value.trim()).catch(() => {}); });
$('join-code').addEventListener('input', updateEntry);
$('invite').addEventListener('click', copyInvite);
$('leave').addEventListener('click', async () => {
  if (room.deadline && !confirm('Leave the room? This ends the current round for everyone.')) return;
  try { await mutate('leave'); exitRoom(); } catch {}
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
window.addEventListener('online', () => poll());
setInterval(tick, 150);
$('name').value = store.get('name') || '';
const initialCode = new URL(location.href).searchParams.get('room')?.trim().toUpperCase() || '';
$('join-code').value = initialCode; updateEntry();
if (initialCode && store.get(`seat:${initialCode}`)) {
  roomCode = initialCode; token = store.get(`seat:${initialCode}`); poll();
}

// Optional agent access uses the same actions, credentials, and server checks.
// It cannot retrieve another player's answer or bypass a phase deadline.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    {name: 'nutshell_read_room', description: 'Read this player’s visible room state, never hidden answers.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true, untrustedContentHint: true}, execute: async () => {
      if (!room) return {joined: false};
      const result = await request('state'); accept(result.room); return result.room;
    }},
    {name: 'nutshell_create_or_join_room', description: 'Create a three-player game room, or join an invite code, using the supplied display name.', inputSchema: {type: 'object', properties: {name: {type: 'string', minLength: 1, maxLength: 24}, code: {type: 'string'}}, required: ['name'], additionalProperties: false}, annotations: {readOnlyHint: false, untrustedContentHint: true}, execute: async input => {
      if (room) throw new Error('Leave the current room first.');
      if (!input || typeof input.name !== 'string' || (input.code !== undefined && typeof input.code !== 'string')) throw new Error('Supply a name and optional room code.');
      return enter(input.name, input.code || '');
    }}
  ];
  for (const tool of tools) {
    try { Promise.resolve(document.modelContext.registerTool(tool, {signal: lifecycle.signal})).catch(() => {}); } catch {}
  }
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
}
