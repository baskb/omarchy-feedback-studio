// Pure helpers for the Feedback Studio bar widget: parsing what bin/fbs-sessions
// prints, the text the rows show, and the QR matrix parser. No QML types here,
// so the file can be unit-tested with plain node (see test/).

function str(value) {
  return value === undefined || value === null ? "" : String(value)
}

function num(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

// bin/fbs-sessions prints a JSON array; anything else is reported, never guessed.
function parseSessions(raw) {
  var text = String(raw || "").trim()
  if (text === "") return { ok: true, sessions: [], error: "" }
  var list
  try { list = JSON.parse(text) } catch (e) {
    return { ok: false, sessions: [], error: "Could not read the session list" }
  }
  if (!Array.isArray(list)) return { ok: false, sessions: [], error: "Unexpected session list" }
  var sessions = []
  for (var i = 0; i < list.length; i++) sessions.push(normalizeSession(list[i]))
  return { ok: true, sessions: sessions, error: "" }
}

function normalizeSession(s) {
  s = s && typeof s === "object" ? s : {}
  return {
    pid: num(s.pid),
    port: num(s.port),
    label: str(s.label),
    project: str(s.project),
    mode: str(s.mode) || "static",
    served: str(s.served),
    cwd: str(s.cwd),
    url: str(s.url),
    phoneUrl: str(s.phoneUrl),
    tunnel: s.tunnel === true,
    reachable: s.reachable !== false,
    total: num(s.total),
    open: num(s.open),
    resolved: num(s.resolved),
    agent: s.agent && typeof s.agent === "object" ? s.agent : null,
    startedAt: str(s.startedAt)
  }
}

function title(s) {
  return s.label || s.project || ("port " + s.port)
}

function modeGlyph(mode) {
  if (mode === "demo") return "󰐊"
  if (mode === "md") return "󰍔"
  if (mode === "proxy") return "󰒋"
  return "󰖟"
}

function modeLabel(mode) {
  if (mode === "demo") return "demo"
  if (mode === "md") return "Markdown"
  if (mode === "proxy") return "dev server"
  return "static site"
}

function countsLine(s) {
  if (!s.reachable) return "not responding"
  if (s.total === 0) return "no comments yet"
  var parts = [s.open + " open"]
  if (s.resolved > 0) parts.push(s.resolved + " resolved")
  parts.push(s.total + " total")
  return parts.join(" · ")
}

function metaLine(s) {
  var parts = [modeLabel(s.mode)]
  if (s.served && s.mode !== "demo") parts.push(s.served)
  parts.push(":" + s.port)
  if (s.tunnel) parts.push("tunnel")
  else if (s.phoneUrl) parts.push("LAN")
  return parts.join(" · ")
}

// One line about the coding agent, or "" when none is on this session.
function agentLine(s) {
  var a = s.agent
  if (!a || !a.state || a.state === "offline") return ""
  var name = str(a.name) || "Agent"
  if (a.state === "working") {
    var note = str(a.note)
    return name + " is on a comment" + (note ? " · " + note : "")
  }
  return name + " is online"
}

function openTotal(sessions) {
  var n = 0
  for (var i = 0; i < sessions.length; i++) n += sessions[i].open
  return n
}

function summary(sessions) {
  if (sessions.length === 0) return "No review running"
  var open = openTotal(sessions)
  var head = sessions.length === 1 ? "1 session" : sessions.length + " sessions"
  return head + " · " + (open === 1 ? "1 open comment" : open + " open comments")
}

function phoneHint(s) {
  if (s.phoneUrl) return ""
  return "Local only. Start it with --tunnel (or --host 0.0.0.0 on your LAN) to reach it from a phone."
}

// bin/fbs-qr prints a square 0/1 matrix; a malformed one renders nothing rather
// than a code that cannot scan.
function parseQrMatrix(raw) {
  var lines = String(raw || "").trim().split(/\r?\n/).filter(function(line) { return line !== "" })
  if (lines.length === 0) return { rows: [], size: 0 }
  var size = lines[0].length
  if (size !== lines.length) return { rows: [], size: 0 }
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].length !== size || !/^[01]+$/.test(lines[i])) return { rows: [], size: 0 }
  }
  return { rows: lines, size: size }
}

if (typeof module !== "undefined") {
  module.exports = {
    parseSessions: parseSessions,
    normalizeSession: normalizeSession,
    title: title,
    modeGlyph: modeGlyph,
    modeLabel: modeLabel,
    countsLine: countsLine,
    metaLine: metaLine,
    agentLine: agentLine,
    openTotal: openTotal,
    summary: summary,
    phoneHint: phoneHint,
    parseQrMatrix: parseQrMatrix
  }
}
