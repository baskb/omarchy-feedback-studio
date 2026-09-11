// Unit tests for Model.js, the widget's pure helpers. Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const Model = createRequire(import.meta.url)(path.join(here, '..', 'Model.js'));

const sample = {
  pid: 4242, port: 4444, label: 'Marketing', project: 'site', mode: 'static', served: 'dist',
  cwd: '/home/me/site', url: 'http://localhost:4444/', phoneUrl: 'https://abc.trycloudflare.com/',
  tunnel: true, reachable: true, total: 7, open: 3, resolved: 4, agent: { state: 'working', name: 'Claude', note: 'editing src/Header.jsx' },
  startedAt: '2026-09-01T10:00:00.000Z',
};

test('parseSessions accepts an empty list and an empty string', () => {
  assert.deepEqual(Model.parseSessions('[]').sessions, []);
  assert.deepEqual(Model.parseSessions('').sessions, []);
  assert.equal(Model.parseSessions('').ok, true);
});

test('parseSessions reports junk instead of guessing', () => {
  const r = Model.parseSessions('<html>nope');
  assert.equal(r.ok, false);
  assert.equal(r.sessions.length, 0);
  assert.match(r.error, /session list/i);
  assert.equal(Model.parseSessions('{"not":"a list"}').ok, false);
});

test('normalizeSession fills every field with a safe default', () => {
  const s = Model.normalizeSession({ pid: '12', total: '3' });
  assert.equal(s.pid, 12);
  assert.equal(s.total, 3);
  assert.equal(s.mode, 'static');
  assert.equal(s.reachable, true);
  assert.equal(s.phoneUrl, '');
  assert.equal(s.agent, null);
});

test('row text: title, counts, meta, agent', () => {
  const s = Model.normalizeSession(sample);
  assert.equal(Model.title(s), 'Marketing');
  assert.equal(Model.title(Model.normalizeSession({ project: 'site', port: 1 })), 'site');
  assert.equal(Model.title(Model.normalizeSession({ port: 4001 })), 'port 4001');
  assert.equal(Model.countsLine(s), '3 open · 4 resolved · 7 total');
  assert.equal(Model.countsLine(Model.normalizeSession({ total: 0 })), 'no comments yet');
  assert.equal(Model.countsLine(Model.normalizeSession({ reachable: false, total: 5 })), 'not responding');
  assert.equal(Model.metaLine(s), 'static site · dist · :4444 · tunnel');
  assert.equal(Model.metaLine(Model.normalizeSession({ mode: 'md', served: 'report.md', port: 4445 })), 'Markdown · report.md · :4445');
  assert.equal(Model.agentLine(s), 'Claude is on a comment · editing src/Header.jsx');
  assert.equal(Model.agentLine(Model.normalizeSession({ agent: { state: 'online', name: 'Codex' } })), 'Codex is online');
  assert.equal(Model.agentLine(Model.normalizeSession({ agent: { state: 'offline' } })), '');
  assert.equal(Model.agentLine(Model.normalizeSession({})), '');
});

test('summary and openTotal aggregate sessions', () => {
  assert.equal(Model.summary([]), 'No review running');
  const a = Model.normalizeSession(sample);
  const b = Model.normalizeSession({ ...sample, pid: 1, open: 1 });
  assert.equal(Model.openTotal([a, b]), 4);
  assert.equal(Model.summary([a]), '1 session · 3 open comments');
  assert.equal(Model.summary([a, b]), '2 sessions · 4 open comments');
  assert.equal(Model.summary([Model.normalizeSession({ open: 1 })]), '1 session · 1 open comment');
});

test('phoneHint only speaks up for local-only sessions', () => {
  assert.equal(Model.phoneHint(Model.normalizeSession(sample)), '');
  assert.match(Model.phoneHint(Model.normalizeSession({})), /--tunnel/);
});

test('parseQrMatrix accepts a square 0/1 matrix and rejects anything else', () => {
  assert.deepEqual(Model.parseQrMatrix('101\n010\n101\n'), { rows: ['101', '010', '101'], size: 3 });
  assert.equal(Model.parseQrMatrix('101\n010').size, 0);
  assert.equal(Model.parseQrMatrix('1x1\n010\n101').size, 0);
  assert.equal(Model.parseQrMatrix('').size, 0);
});

test('title says Demo for a demo session, label still wins', () => {
  assert.equal(Model.title(Model.normalizeSession({ mode: 'demo', cwd: '/home/me', project: 'me', port: 4444 })), 'Demo');
  assert.equal(Model.title(Model.normalizeSession({ mode: 'demo', label: 'Roastly', port: 4444 })), 'Roastly');
});

test('counts and meta mention what waits for the reviewer and the tailnet', () => {
  const s = Model.normalizeSession({ ...sample, forYou: 2, tunnel: false, tailscale: true });
  assert.equal(Model.countsLine(s), '3 open (2 for you) · 4 resolved · 7 total');
  assert.equal(Model.metaLine(s), 'static site · dist · :4444 · tailnet');
  assert.equal(Model.metaLine(Model.normalizeSession({ ...sample, tunnel: false, tailscale: 'fallback' })), 'static site · dist · :4444 · tailnet');
});

test('newComments diffs recent ids and skips the agent\'s own', () => {
  const s = Model.normalizeSession({ recent: [
    { id: 'c1', type: 'question', text: 'Why?', author: 'user' },
    { id: 'c2', type: 'change', text: 'Bigger', author: 'user', authorName: 'Ann' },
    { id: 'c3', type: 'improve', text: 'Proposal', author: 'agent' },
  ], open: 3 });
  assert.deepEqual(Model.newComments(s, {}).map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(Model.newComments(s, { c1: true }).map((c) => c.id), ['c2']);
  assert.deepEqual(Object.keys(Model.recentIds(s)).sort(), ['c1', 'c2', 'c3']);
});

test('notification text: one comment quotes it, several count them', () => {
  const s = Model.normalizeSession({ project: 'site', open: 4, recent: [
    { id: 'c1', type: 'question', text: 'Why is this here?', author: 'user' },
    { id: 'c2', type: 'change', text: 'Bigger', author: 'user', authorName: 'Ann' },
  ] });
  const one = Model.newCommentNotification(s, [s.recent[1]]);
  assert.equal(one.headline, 'Change · site');
  assert.equal(one.body, 'Ann: “Bigger” · 4 open');
  const two = Model.newCommentNotification(s, s.recent);
  assert.equal(two.headline, '2 new comments · site');
  assert.equal(two.body, '“Why is this here?” and 1 more · 4 open');
  const empty = Model.newCommentNotification(s, [{ id: 'x', type: 'fix', text: '', author: 'user' }]);
  assert.equal(empty.body, 'fix without text · 4 open');
});

test('a question is stale only when old enough and no agent is around', () => {
  const now = Date.parse('2026-09-11T12:00:00Z');
  const old = '2026-09-11T11:40:00Z';
  assert.equal(Model.questionIsStale(Model.normalizeSession({ staleQuestionSince: old }), 10, now), true);
  assert.equal(Model.questionIsStale(Model.normalizeSession({ staleQuestionSince: old }), 30, now), false);
  assert.equal(Model.questionIsStale(Model.normalizeSession({ staleQuestionSince: old }), 0, now), false);
  assert.equal(Model.questionIsStale(Model.normalizeSession({ staleQuestionSince: old, agent: { state: 'online' } }), 10, now), false);
  assert.equal(Model.questionIsStale(Model.normalizeSession({ staleQuestionSince: '' }), 10, now), false);
  assert.match(Model.staleNotification(Model.normalizeSession({ project: 'site' }), 10).body, /10 minutes/);
});

test('round done, agent state, activity, and desktop lines', () => {
  const s = Model.normalizeSession({ project: 'site', open: 1, forYou: 1, resolved: 3 });
  assert.deepEqual(Model.roundDoneNotification(s, 3), { headline: 'Round done · site', body: '3 comments applied · 1 open · 1 for you' });
  assert.equal(Model.roundDoneNotification(s, 1).body, '1 comment applied · 1 open · 1 for you');
  const working = Model.normalizeSession({ agent: { state: 'working' } });
  const online = Model.normalizeSession({ agent: { state: 'online' } });
  assert.equal(Model.agentState([online, working]), 'working');
  assert.equal(Model.agentState([online]), 'online');
  assert.equal(Model.agentState([Model.normalizeSession({})]), '');
  assert.equal(Model.forYouTotal([s, s]), 2);
  const now = Date.parse('2026-09-11T12:00:00Z');
  assert.equal(Model.activityLine(Model.normalizeSession({ activity: { kind: 'edit', file: 'src/a.js', text: 'edited', at: now - 120000 } }), now), 'edited src/a.js · 2m ago');
  assert.equal(Model.activityLine(Model.normalizeSession({ activity: { kind: 'resolve', text: 'resolved #4', at: now - 5000 } }), now), 'resolved #4 · just now');
  assert.equal(Model.activityLine(Model.normalizeSession({}), now), '');
  assert.equal(Model.desktopLine(Model.normalizeSession({ claudeHere: 1 })), 'Claude Code is open in this project');
  assert.equal(Model.desktopLine(Model.normalizeSession({ claudeHere: 1, agent: { state: 'online' } })), '');
  assert.equal(Model.desktopLine(Model.normalizeSession({})), '');
});
