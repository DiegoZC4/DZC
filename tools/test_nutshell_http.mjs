import assert from 'node:assert/strict';
const base = new URL(process.argv[2] || 'http://127.0.0.1:8798/nutshell/');
if (!['127.0.0.1', 'localhost', 'diegozc.com', 'www.diegozc.com'].includes(base.hostname)) throw new Error('Use the known local or personal website host.');
let code = '', state, clients = [];
async function api(action, body = {}, token = '', expected = 200) {
  const options = {headers: {'X-Nutshell-Token': token}, signal: AbortSignal.timeout(12000)};
  let url = new URL('api.php', base);
  if (action === 'state') url.searchParams.set('room', code);
  else { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({action, room: code, ...body}); }
  const response = await fetch(url, options);
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  if (data.room) state = data.room;
  return data;
}
function current(body = {}) { return {round: state.round, phase: state.phase, ...body}; }
try {
  const creator = await api('create', {name: 'QA writer'}); code = creator.room.code; clients.push(creator.token);
  clients.push((await api('join', {name: 'QA masker'})).token);
  clients.push((await api('join', {name: 'QA guesser'})).token);
  await api('join', {name: 'Fourth'}, '', 409);
  await api('state', {}, '0'.repeat(64), 401);
  await api('settings', {settings: {write: 10, mask: 10, guess: 10}}, clients[2], 403);
  await api('settings', {settings: {write: 10, mask: 10, guess: 10}}, clients[0]);
  await api('start', current(), clients[0]);
  await api('draft', current({question: 'Which planet has spectacular rings?', answer: 'Saturn'}), clients[0]);
  const privateView = (await api('state', {}, clients[2])).room;
  assert.equal(privateView.answer, undefined); assert.equal(privateView.question, undefined);
  await api('submit', current({question: 'Which planet has spectacular rings?', answer: 'Saturn'}), clients[0]);
  await api('submit', current({visible: [false, true, false, false, true]}), clients[1]);
  const guessView = (await api('state', {}, clients[2])).room;
  assert.deepEqual(guessView.words, [null, 'planet', null, null, 'rings?']);
  assert.equal(guessView.answer, undefined);
  assert.ok(guessView.players.every(p => !('secret' in p)));
  await api('submit', current({guess: 'Saturn'}), clients[2]);
  assert.equal(state.answer, 'Saturn');
  await api('judge', current({correct: true}), clients[2], 403);
  await api('judge', current({correct: true}), clients[0]);
  await api('start', current(), clients[0]);
  const rotated = (await api('state', {}, clients[1])).room;
  assert.equal(rotated.role, 'write'); assert.equal(rotated.round, 2);
  console.log('Three-client HTTP game, secret filtering, permissions, reconnect and role rotation passed.');
} finally {
  for (const client of clients) {
    try { await api('leave', {}, client); } catch (error) { console.error('QA room cleanup:', error.message); }
  }
}
