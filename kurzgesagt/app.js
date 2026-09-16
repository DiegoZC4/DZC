'use strict';

const $ = id => document.getElementById(id);
const SCREENS = ['write', 'mask', 'guess'];

// --- Slot-aware identity -----------------------------------------------------------------
// localStorage is shared by every tab on an origin, so the player token is namespaced by a
// slot taken from the hash: #guess/K7M2QX@2 is a different human from #guess/K7M2QX. This
// ships ungated, because a hostname check would mean the identity path tested locally is
// not the one that runs live. It is not a security boundary: the server only ever trusts
// the token, and the slot just picks which key holds it.
let slot = '0';
let route = {screen: 'guess', id: ''};
let mounted = '';
const store = {
  key(name) { return `kurzgesagt:${slot}:${name}`; },
  get(name) { try { return localStorage.getItem(store.key(name)); } catch { return null; } },
  set(name, value) { try { localStorage.setItem(store.key(name), value); } catch {} }
};
// Every internal navigation goes through here, or a tab silently becomes player 0 after
// its second click.
function href(screen, id = '') { return `#${screen}${id ? '/' + id : ''}${slot === '0' ? '' : '@' + slot}`; }
function go(screen, id = '') {
  const target = href(screen, id);
  if (location.hash === target) router();
  else location.hash = target;
}
function setHash(screen, id = '') {
  history.replaceState({}, '', location.pathname + location.search + href(screen, id));
  route = {screen: screen, id: id};
}
// Shared links never carry a slot: whoever opens one is whoever they already were.
function shareLink(id) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = `#guess/${id}`;
  return url.href;
}
function parseHash() {
  let raw = location.hash.replace(/^#/, '');
  try { raw = decodeURIComponent(raw); } catch (error) { /* keep the raw hash */ }
  const match = raw.match(/^(.*)@(\d{1,3})$/);
  slot = match ? match[2] : '0';
  const parts = (match ? match[1] : raw).split('/').filter(Boolean);
  let screen = (parts[0] || 'guess').toLowerCase();
  let id = (parts[1] || '').toUpperCase();
  if (!SCREENS.includes(screen)) { id = screen.toUpperCase(); screen = 'guess'; }
  return {screen: screen, id: id};
}

// --- Small shared pieces ------------------------------------------------------------------
let toastTimer;
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
// Mirrors kg_normalize() closely enough for filtering and the masker's preview. The server
// is always the authority on what actually matches an answer.
function fold(text) {
  return String(text === null || text === undefined ? '' : text).toLowerCase()
    .normalize('NFD').replace(/\p{Mn}+/gu, '')
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/[øö]/g, 'o').replace(/[ðđ]/g, 'd').replace(/þ/g, 'th').replace(/ł/g, 'l')
    .replace(/['\u2018\u2019\u02bc\u0060\u00b4]+/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function countWords(text) {
  const trimmed = String(text).trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
function ago(seconds) {
  const delta = Math.max(0, Date.now() / 1000 - Number(seconds));
  if (delta < 90) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 172800) return `${Math.floor(delta / 3600)} h ago`;
  return `${Math.floor(delta / 86400)} d ago`;
}
async function api(method, action, payload = {}) {
  const token = store.get('player') || '';
  const options = {cache: 'no-store', signal: AbortSignal.timeout(12000), headers: {}};
  if (token) options.headers['X-Kurzgesagt-Token'] = token;
  let url = 'api.php';
  if (method === 'GET') {
    const params = new URLSearchParams({do: action});
    for (const [key, value] of Object.entries(payload)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    url += '?' + params.toString();
  } else {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(Object.assign({action: action}, payload));
  }
  const response = await fetch(url, options);
  let result;
  try { result = await response.json(); } catch (error) { throw new Error('The puzzle server is not responding. Please try again.'); }
  if (result && typeof result.token === 'string') store.set('player', result.token);
  if (!response.ok) {
    const error = new Error(result.error || 'That did not go through. Try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}
async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); notify(message); }
  catch (error) { notify(`Copy this: ${text}`, true); }
}

// --- The board ------------------------------------------------------------------------------
// A covered word arrives as literal null, is rendered with an empty text node, and gets a
// fixed width from CSS. A masked row is a row of identical squares, never a skyline.
function boardTiles(target, words, visible) {
  target.replaceChildren();
  words.forEach((word, index) => {
    const shown = word !== null && word !== undefined;
    const open = shown && (!visible || visible[index]);
    const tile = element('span', shown ? word : '', `word ${shown ? (open ? 'chosen' : 'revealed') : 'blank'}`);
    if (!shown) tile.setAttribute('aria-label', 'Hidden word');
    target.append(tile);
  });
}
function roundZero(count) { return Math.max(1, Math.ceil(count / 4)); }
function wordKey(words, index) {
  const key = fold(words[index]);
  return key === '' ? '\u0000' + index : key;
}
function visibleFor(words, order, steps) {
  const shown = new Set();
  for (let i = 0; i < Math.min(steps, order.length); i++) shown.add(wordKey(words, order[i]));
  return words.map((word, index) => shown.has(wordKey(words, index)));
}
// Mirrors kg_order(): clicked words first, the rest in sentence order, answer words last.
function effectiveOrder(words, clicked, answer) {
  const order = clicked.slice();
  for (let i = 0; i < words.length; i++) if (!order.includes(i)) order.push(i);
  const alternatives = String(answer).split('|').map(fold).filter(Boolean);
  const spoils = index => {
    const word = fold(words[index]);
    return word !== '' && alternatives.some(alternative => alternative.split(' ').includes(word));
  };
  return order.filter(index => !spoils(index)).concat(order.filter(spoils));
}

// --- 01 / Write ------------------------------------------------------------------------------
function updateWriteCount() {
  const count = countWords($('question').value);
  $('write-words').textContent = `${count} / 40 words`;
}
function mountWrite() {
  updateWriteCount();
  if (mounted !== 'write') $('write-state').replaceChildren();
}
$('question').addEventListener('input', updateWriteCount);
$('write-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('write-submit');
  submit.disabled = true;
  try {
    const result = await api('POST', 'write', {question: $('question').value, answer: $('answer').value});
    $('question').value = '';
    $('answer').value = '';
    updateWriteCount();
    notify('Added to the pool.');
    $('write-state').replaceChildren(document.createTextNode('In the pool. '), button('Mask it now →', () => go('mask', result.id), 'quiet'));
    $('question').focus();
  } catch (error) { notify(error.message); }
  finally { submit.disabled = false; }
});

// --- 02 / Mask --------------------------------------------------------------------------------
let poolTimer = null;
let poolVersion = -1;
let pool = [];
let recent = [];
let draft = null;
let clicked = [];
function filteredPool() {
  const term = fold($('pool-search').value);
  return term === '' ? pool.slice() : pool.filter(item => fold(item.question).includes(term));
}
// Re-rendering only the list leaves the search box and the current selection alone.
function renderPoolList() {
  const term = fold($('pool-search').value);
  const matches = filteredPool();
  const list = $('pool-list');
  list.replaceChildren();
  for (const item of matches) {
    const el = button('', () => go('mask', item.id), 'pool-item');
    el.replaceChildren(document.createTextNode(item.question), element('small', `${item.words} words · added ${ago(item.created)}`));
    el.setAttribute('aria-pressed', String(item.id === route.id));
    list.append(el);
  }
  if (pool.length === 0) {
    $('pool-status').replaceChildren(document.createTextNode('The pool is empty. '), button('Write one →', () => go('write'), 'quiet'));
  } else {
    $('pool-status').textContent = `${pool.length} unpublished question${pool.length === 1 ? '' : 's'}, oldest first`
      + (term === '' ? '' : ` · ${matches.length} matching`) + '. Updates on its own.';
  }
  $('pool-random').disabled = matches.length === 0;
  $('pool-random').textContent = term === '' ? 'Pick random' : `Pick random of ${matches.length}`;
  $('pool-recent').textContent = recent.length === 0 ? '' : `${recent.length} recent puzzle${recent.length === 1 ? '' : 's'} published. Newest: ${recent[0].id}, ${ago(recent[0].created)}.`;
}
async function refreshPool() {
  const result = await api('GET', 'pool');
  poolVersion = result.version;
  pool = result.questions || [];
  recent = result.recent || [];
  renderPoolList();
}
function schedulePool() {
  clearTimeout(poolTimer);
  poolTimer = setTimeout(pollPool, document.hidden ? 10000 : 3000);
}
// A cheap integer poll. The list only re-renders when the pool actually changed, so what
// the masker is typing or has selected survives a stranger's submission.
async function pollPool() {
  if (route.screen !== 'mask') return;
  try {
    const result = await api('GET', 'version');
    if (result.version !== poolVersion) await refreshPool();
  } catch (error) { /* the next poll retries */ }
  schedulePool();
}
function renderEditor() {
  const has = draft !== null;
  $('mask-editor').hidden = !has;
  $('mask-empty').hidden = has;
  if (!has) return;
  $('mask-answer').textContent = draft.answer;
  const grid = $('mask-words');
  grid.replaceChildren();
  draft.words.forEach((word, index) => {
    const position = clicked.indexOf(index);
    const tile = button(word, () => toggleWord(index), `word${position >= 0 ? ' chosen' : ''}`);
    if (position >= 0) tile.append(element('span', String(position + 1), 'ord'));
    tile.setAttribute('aria-pressed', String(position >= 0));
    tile.setAttribute('aria-label', position >= 0 ? `${word}, uncovered ${position + 1}. Remove from the order` : `${word}. Add to the reveal order`);
    grid.append(tile);
  });
  const order = effectiveOrder(draft.words, clicked, draft.answer);
  const visible = visibleFor(draft.words, order, roundZero(draft.words.length));
  boardTiles($('mask-preview'), draft.words.map((word, index) => visible[index] ? word : null), visible);
  $('mask-count').textContent = `${clicked.length} placed · ${draft.words.length - clicked.length} follow in sentence order`;
}
function toggleWord(index) {
  const position = clicked.indexOf(index);
  if (position >= 0) clicked.splice(position, 1);
  else clicked.push(index);
  renderEditor();
}
async function selectQuestion(id) {
  try {
    const result = await api('GET', 'question', {id: id});
    draft = {id: result.id, question: result.question, answer: result.answer, words: result.words};
    clicked = [];
    renderEditor();
  } catch (error) {
    draft = null;
    clicked = [];
    renderEditor();
    notify(error.message);
    if (route.id) go('mask');
  }
}
function mountMask() {
  if (mounted !== 'mask') {
    pool = [];
    recent = [];
    poolVersion = -1;
    refreshPool().catch(error => notify(error.message));
  }
  schedulePool();
  if (route.id && (draft === null || draft.id !== route.id)) selectQuestion(route.id);
  if (!route.id && draft !== null) { draft = null; clicked = []; }
  renderEditor();
  renderPoolList();
}
$('pool-search').addEventListener('input', renderPoolList);
$('pool-random').addEventListener('click', () => {
  const matches = filteredPool();
  if (matches.length === 0) return;
  go('mask', matches[Math.floor(Math.random() * matches.length)].id);
});
$('mask-clear').addEventListener('click', () => { clicked = []; renderEditor(); });
$('mask-publish').addEventListener('click', async () => {
  if (draft === null) return;
  $('mask-publish').disabled = true;
  try {
    const result = await api('POST', 'publish', {question: draft.id, clicked: clicked});
    draft = null;
    clicked = [];
    poolVersion = -1;
    notify('Published. Copy the link and send it round.');
    go('guess', result.id);
  } catch (error) { notify(error.message); }
  finally { $('mask-publish').disabled = false; }
});

// --- 03 / Guess ---------------------------------------------------------------------------------
let puzzle = null;
let board = null;
let busy = false;
let loadedSlot = '';
function renderEmpty(message) {
  puzzle = null;
  board = null;
  $('guess-title').textContent = message;
  $('guess-round').hidden = true;
  $('guess-summary').textContent = '';
  $('guess-free').textContent = '';
  $('guess-tried').textContent = '';
  $('guess-board').replaceChildren();
  $('guess-form').hidden = true;
  $('guess-done').hidden = true;
  $('guess-actions').replaceChildren(button('Write one →', () => go('write'), 'primary'), button('Mask one →', () => go('mask')));
  $('guess-footer').replaceChildren();
}
function renderLadder() {
  const ladder = $('ladder');
  ladder.replaceChildren();
  const rows = board && board.rows ? board.rows : [];
  if (rows.length === 0) {
    ladder.append(element('li', 'Nobody has finished this one yet.'));
    return;
  }
  for (const row of rows) {
    const item = element('li', undefined, row.you ? 'you' : '');
    item.append(element('span', row.rank === null ? '—' : String(row.rank), 'rank'));
    const who = element('span', row.name, 'who');
    if (row.you) who.append(element('span', 'you', 'tagline'));
    item.append(who, element('span', row.author ? 'author' : String(row.score), 'score'));
    ladder.append(item);
  }
}
function renderGuess() {
  if (puzzle === null) return;
  const done = puzzle.solved || puzzle.ended;
  $('guess-round').hidden = false;
  $('guess-round').textContent = String(puzzle.rounds);
  $('guess-title').textContent = puzzle.solved ? 'Cracked it.' : puzzle.ended ? 'You asked for the answer.' : puzzle.rounds === 0 ? 'Nothing spent yet.' : 'Keep going.';
  $('guess-summary').textContent = done ? '' : board && board.solved > 0 ? `${board.solved} solved, best ${board.best}.` : 'Nobody has solved this one yet.';
  boardTiles($('guess-board'), puzzle.words, puzzle.visible);
  $('guess-free').textContent = done ? '' : puzzle.complete ? `Everything is showing. Guessing still costs 1.` : `Uncovered for free: ${puzzle.free} of ${puzzle.total}. Hidden: ${puzzle.hidden}.`;
  $('guess-tried').textContent = puzzle.tried.length === 0 ? '' : `Tried: ${puzzle.tried.join(', ')}.`;
  $('guess-form').hidden = done;
  const actions = $('guess-actions');
  actions.replaceChildren();
  if (!done) {
    const pass = button(puzzle.complete ? 'Everything’s showing' : 'Pass · 1', () => act('pass'));
    pass.disabled = puzzle.complete || busy;
    actions.append(pass);
    actions.append(button('Show the answer', () => {
      if (confirm('Show the answer? This ends your run.')) act('reveal');
    }, 'danger'));
  }
  $('guess-done').hidden = !done;
  if (done) {
    $('done-question').textContent = puzzle.question || '';
    $('done-answer').textContent = puzzle.answer || '';
    $('done-outcome').textContent = puzzle.solved ? `Solved in ${puzzle.score}.` : 'Run ended without solving. No score.';
    $('done-outcome').className = puzzle.solved ? 'outcome' : 'outcome missed';
    $('name-form').hidden = !puzzle.solved;
    if (document.activeElement !== $('name-input')) $('name-input').value = puzzle.name || '';
    renderLadder();
  }
  const footer = $('guess-footer');
  footer.replaceChildren();
  footer.append(button('Copy link', () => copy(shareLink(puzzle.id), 'Link copied. It carries no player slot.')));
  footer.append(button('Next puzzle →', nextPuzzle));
  footer.append(button('Write one →', () => go('write'), 'quiet'));
}
async function act(action, payload = {}) {
  if (busy || puzzle === null) return '';
  busy = true;
  try {
    const result = await api('POST', action, Object.assign({id: puzzle.id, round: puzzle.rounds}, payload));
    puzzle = result.puzzle;
    board = result.board;
    if (result.outcome === 'repeat') notify('You already tried that. That one is free.');
    else if (result.outcome === 'wrong') notify('Not it. That cost a round and uncovered nothing.');
    else if (result.outcome === 'stale') notify('That arrived late. Here is where you actually are.');
    busy = false;
    renderGuess();
    return result.outcome;
  } catch (error) {
    busy = false;
    notify(error.message);
    return '';
  }
}
async function nextPuzzle() {
  try {
    const result = await api('GET', 'puzzles');
    const others = (result.puzzles || []).filter(item => !puzzle || item.id !== puzzle.id);
    if (others.length === 0) { notify('That is the only puzzle so far. Write one.'); return; }
    go('guess', others[Math.floor(Math.random() * others.length)].id);
  } catch (error) { notify(error.message); }
}
async function mountGuess() {
  const wanted = route.id;
  // The slot is part of the cache key: #guess/K7M2QX@2 is a different player from
  // #guess/K7M2QX, so the same puzzle must be fetched again for their own progress.
  if (puzzle !== null && puzzle.id === wanted && loadedSlot === slot) { renderGuess(); return; }
  $('guess-title').textContent = 'Loading…';
  try {
    const result = await api('GET', 'puzzle', wanted ? {id: wanted} : {});
    if (result.empty) { renderEmpty('Nothing here yet.'); return; }
    puzzle = result.puzzle;
    board = result.board;
    loadedSlot = slot;
    if (puzzle.id !== wanted) setHash('guess', puzzle.id);
    renderGuess();
  } catch (error) {
    renderEmpty(error.status === 404 ? 'No puzzle with that code.' : 'The puzzle server is not answering.');
    notify(error.message);
  }
}
$('guess-form').addEventListener('submit', async event => {
  event.preventDefault();
  const value = $('guess-input').value.trim();
  if (value === '') return;
  $('guess-submit').disabled = true;
  const outcome = await act('guess', {guess: value});
  $('guess-submit').disabled = false;
  if (outcome === 'wrong' || outcome === 'correct') $('guess-input').value = '';
  if (!$('guess-form').hidden) $('guess-input').focus();
});
$('name-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('name-submit').disabled = true;
  const outcome = await act('name', {name: $('name-input').value.trim()});
  $('name-submit').disabled = false;
  if (outcome === 'named') notify('Saved to the board.');
});

// --- Router ---------------------------------------------------------------------------------------
function router() {
  route = parseHash();
  for (const screen of SCREENS) {
    $(`screen-${screen}`).hidden = screen !== route.screen;
    const tab = $(`tab-${screen}`);
    tab.href = href(screen);
    tab.classList.toggle('on', screen === route.screen);
  }
  if (route.screen !== 'mask') clearTimeout(poolTimer);
  if (route.screen === 'write') mountWrite();
  else if (route.screen === 'mask') mountMask();
  else mountGuess();
  mounted = route.screen;
}
window.addEventListener('hashchange', router);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && route.screen === 'mask') { clearTimeout(poolTimer); pollPool(); }
});
router();
