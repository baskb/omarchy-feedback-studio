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
