// Integration tests for bin/fbs-sessions, the script that lists running
// Feedback Studio servers as JSON. Run: node --test test/
//
// Each case points CLAUDE_PLUGIN_DATA at a fresh temp dir and runs the script
// for real (bash, jq, curl). Assertions only cover the fields that exist today;
// extra fields in the output are fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'bin', 'fbs-sessions');

// Runs the script asynchronously: a synchronous spawn would block the event
// loop, and with it the in-process test server the script has to talk to.
async function run(dataDir) {
  const r = await new Promise((resolve) => {
    execFile('bash', [script], {
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });
  assert.equal(r.status, 0, `exit status ${r.status}\nstderr: ${r.stderr}`);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(r.stdout); }, `stdout is not JSON: ${r.stdout}`);
  assert.ok(Array.isArray(parsed), 'stdout is not a JSON array');
  return parsed;
}

function tempData() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fbs-sessions-test-'));
  return { dir, sessions: path.join(dir, 'sessions'), rm: () => rmSync(dir, { recursive: true, force: true }) };
}

function registryEntry(port, extra = {}) {
  return {
    pid: process.pid,
    port,
    apiBase: `http://127.0.0.1:${port}/__feedback/api`,
    cwd: '/tmp/some/project',
    mode: 'static',
    url: `http://localhost:${port}/`,
    startedAt: '2026-09-01T10:00:00.000Z',
    ...extra,
  };
}

// Listens on an ephemeral port, then closes it, so nothing answers there.
async function closedPort() {
  const s = createServer();
  await new Promise((res) => s.listen(0, '127.0.0.1', res));
  const { port } = s.address();
  await new Promise((res) => s.close(res));
  return port;
}

test('no sessions dir prints an empty list', async () => {
  const t = tempData();
  try {
    assert.deepEqual(await run(t.dir), []);
  } finally { t.rm(); }
});

test('a live session is listed with counts from a >128 KB comments reply', async () => {
  const statuses = ['open', 'approved', 'resolved', 'open', 'resolved'];
  const comments = Array.from({ length: 600 }, (_, i) => ({
    id: `c${i}`,
    status: statuses[i % statuses.length],
    selector: `section:nth-of-type(${i}) > p`,
    text: `Comment ${i}: ${'lorem ipsum dolor sit amet '.repeat(12)}`,
  }));
  const body = JSON.stringify({ comments });
  assert.ok(body.length > 128 * 1024, `comments body is only ${body.length} bytes`);
  const expectedOpen = comments.filter((c) => c.status === 'open' || c.status === 'approved').length;
  const expectedResolved = comments.filter((c) => c.status === 'resolved').length;

  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/__feedback/api/comments')) {
      res.end(body);
    } else if (req.url.startsWith('/__feedback/api/agent-status')) {
      res.end(JSON.stringify({ agent: { state: 'online', name: 'Test' } }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();

  const t = tempData();
  try {
    mkdirSync(t.sessions, { recursive: true });
    writeFileSync(path.join(t.sessions, `${process.pid}.json`), JSON.stringify(registryEntry(port)));

    const out = await run(t.dir);
    assert.equal(out.length, 1);
    const s = out[0];
    assert.equal(s.pid, process.pid);
    assert.equal(s.port, port);
    assert.equal(s.reachable, true);
    assert.equal(s.total, 600);
    assert.equal(s.open, expectedOpen);
    assert.equal(s.resolved, expectedResolved);
    assert.equal(s.project, 'project');
    assert.equal(s.mode, 'static');
    assert.equal(s.cwd, '/tmp/some/project');
    assert.equal(s.startedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(s.agent?.state, 'online');
    assert.equal(s.agent?.name, 'Test');

    const paths = requests.map((r) => r.url.split('?')[0]);
    assert.ok(paths.includes('/__feedback/api/comments'), `no comments request in ${paths}`);
    assert.ok(paths.includes('/__feedback/api/agent-status'), `no agent-status request in ${paths}`);
    for (const r of requests) {
      assert.equal(r.headers['x-feedback-agent'], '0', `missing X-Feedback-Agent: 0 on ${r.url}`);
    }
    assert.ok(existsSync(path.join(t.sessions, `${process.pid}.json`)), 'live entry must not be swept');
  } finally {
    t.rm();
    await new Promise((res) => server.close(res));
  }
});

test('an unreachable session is still listed, marked unreachable', async () => {
  const port = await closedPort();
  const t = tempData();
  try {
    mkdirSync(t.sessions, { recursive: true });
    writeFileSync(path.join(t.sessions, `${process.pid}.json`), JSON.stringify(registryEntry(port)));

    const out = await run(t.dir);
    assert.equal(out.length, 1);
    const s = out[0];
    assert.equal(s.pid, process.pid);
    assert.equal(s.reachable, false);
    assert.equal(s.total, 0);
    assert.equal(s.open, 0);
    assert.equal(s.resolved, 0);
    assert.equal(s.agent, null);
    assert.equal(s.project, 'project');
    assert.ok(existsSync(path.join(t.sessions, `${process.pid}.json`)), 'unreachable entry must not be swept');
  } finally { t.rm(); }
});

test('a dead session is swept and not listed', async () => {
  const deadPid = 2147483000;
  const port = await closedPort();
  const t = tempData();
  try {
    mkdirSync(t.sessions, { recursive: true });
    const file = path.join(t.sessions, `${deadPid}.json`);
    writeFileSync(file, JSON.stringify(registryEntry(port, { pid: deadPid })));

    assert.deepEqual(await run(t.dir), []);
    assert.equal(existsSync(file), false, 'dead entry should have been removed');
  } finally { t.rm(); }
});

test('junk files are swept, and the output stays valid JSON', async () => {
  const t = tempData();
  try {
    mkdirSync(t.sessions, { recursive: true });
    const notJson = path.join(t.sessions, 'junk.json');
    const noPid = path.join(t.sessions, 'nopid.json');
    writeFileSync(notJson, '<html>this is not json');
    writeFileSync(noPid, JSON.stringify({ port: 4444, cwd: '/tmp/x' }));

    assert.deepEqual(await run(t.dir), []);
    assert.equal(existsSync(notJson), false, 'non-JSON file should have been removed');
    assert.equal(existsSync(noPid), false, 'entry without pid should have been removed');
  } finally { t.rm(); }
});

test('recent comments carry photo counts, and long or odd fields are clipped', async () => {
  const comments = [
    { id: 'c1', status: 'open', createdAt: '2026-10-01T10:00:03Z', text: '', authorName: 'A'.repeat(300),
      attachments: [{ id: 'a1', file: 'attachments/c1/a1.jpg' }, { id: 'a2', file: 'attachments/c1/a2.png' }] },
    { id: 'c2', status: 'open', createdAt: '2026-10-01T10:00:02Z', text: 'x'.repeat(500), authorName: 12345, attachments: 'junk' },
    { id: 'c3', status: 'open', createdAt: '2026-10-01T10:00:01Z', text: 'plain', attachments: ['not-an-object'] },
  ];
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/__feedback/api/comments')) res.end(JSON.stringify({ comments }));
    else if (req.url.startsWith('/__feedback/api/agent-status')) res.end(JSON.stringify({ agent: { state: 'working', name: 'N'.repeat(100), note: 'n'.repeat(500) } }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  const t = tempData();
  try {
    mkdirSync(t.sessions, { recursive: true });
    writeFileSync(path.join(t.sessions, `${process.pid}.json`), JSON.stringify(registryEntry(port, { dataDir: '/tmp/some/project/.feedback' })));
    const [s] = await run(t.dir);
    assert.equal(s.dataDir, '/tmp/some/project/.feedback');
    const byId = Object.fromEntries(s.recent.map((c) => [c.id, c]));
    assert.equal(byId.c1.photos, 2);
    assert.equal(byId.c1.photo, 'attachments/c1/a1.jpg');
    assert.equal(byId.c1.authorName.length, 60);
    assert.equal(byId.c2.photos, 0);
    assert.equal(byId.c2.text.length, 90);
    assert.equal(byId.c2.authorName, '12345');
    assert.equal(byId.c3.photos, 1);
    assert.equal(byId.c3.photo, '');
    assert.equal(s.agent.name.length, 40);
    assert.equal(s.agent.note.length, 120);
  } finally {
    t.rm();
    await new Promise((res) => server.close(res));
  }
});
