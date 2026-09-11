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
    startedAt: str(s.startedAt),
    tailscale: s.tailscale === true ? true : (s.tailscale === "fallback" ? "fallback" : false),
    forYou: num(s.forYou),
    staleQuestionSince: str(s.staleQuestionSince),
    recent: Array.isArray(s.recent) ? s.recent.map(normalizeRecent) : [],
    activity: s.activity && typeof s.activity === "object" ? s.activity : null,
    claudeHere: num(s.claudeHere),
    hasReport: s.hasReport === true
  }
}

function normalizeRecent(c) {
  c = c && typeof c === "object" ? c : {}
  return {
    id: str(c.id),
    type: str(c.type),
    author: str(c.author),
    authorName: str(c.authorName),
    createdAt: str(c.createdAt),
    text: str(c.text)
  }
}

function title(s) {
  if (s.label) return s.label
  if (s.mode === "demo") return "Demo"
  return s.project || ("port " + s.port)
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
  var parts = [s.open + " open" + (s.forYou > 0 ? " (" + s.forYou + " for you)" : "")]
  if (s.resolved > 0) parts.push(s.resolved + " resolved")
  parts.push(s.total + " total")
  return parts.join(" · ")
}

function metaLine(s) {
  var parts = [modeLabel(s.mode)]
  if (s.served && s.mode !== "demo") parts.push(s.served)
  parts.push(":" + s.port)
  if (s.tunnel) parts.push("tunnel")
  else if (s.tailscale) parts.push("tailnet")
  else if (s.phoneUrl) parts.push("LAN")
  return parts.join(" · ")
}

// The latest thing that happened on the session, or "" when nothing did.
function activityLine(s, now) {
  var a = s.activity
  if (!a || !a.text) return ""
  var text = str(a.text)
  if (a.kind === "edit" && a.file) text = "edited " + str(a.file)
  return text + (a.at ? " · " + ago(num(a.at), now) : "")
}

function ago(then, now) {
  var sec = Math.max(0, Math.round(((now || Date.now()) - then) / 1000))
  if (sec < 60) return "just now"
  if (sec < 3600) return Math.round(sec / 60) + "m ago"
  if (sec < 86400) return Math.round(sec / 3600) + "h ago"
  return Math.round(sec / 86400) + "d ago"
}

// "Claude Code is open in this project" when it is and no agent is on the session.
function desktopLine(s) {
  if (s.agent && s.agent.state && s.agent.state !== "offline") return ""
  if (s.claudeHere > 0) return "Claude Code is open in this project"
  return ""
}

// The comments in `recent` that were not there at the last poll. `seen` is a
// map of comment id -> true from the previous poll of the same session.
function newComments(s, seen) {
  var out = []
  for (var i = 0; i < s.recent.length; i++) {
    var c = s.recent[i]
    if (c.id && !seen[c.id] && c.author !== "agent") out.push(c)
  }
  return out
}

function recentIds(s) {
  var map = {}
  for (var i = 0; i < s.recent.length; i++) if (s.recent[i].id) map[s.recent[i].id] = true
  return map
}

function typeWord(type) {
  if (type === "question") return "Question"
  if (type === "fix") return "Fix"
  if (type === "change") return "Change"
  if (type === "improve") return "Improve"
  if (type === "rephrase") return "Rephrase"
  if (type === "expand") return "Expand"
  if (type === "delete") return "Delete"
  return "Comment"
}

// Headline and body for the toast about `fresh` (the new comments of one poll).
function newCommentNotification(s, fresh) {
  var n = fresh.length
  var headline = (n === 1 ? typeWord(fresh[0].type) : n + " new comments") + " · " + title(s)
  var first = fresh[0]
  var quote = first.text ? "\u201c" + first.text + "\u201d" : typeWord(first.type).toLowerCase() + " without text"
  var who = first.authorName ? first.authorName + ": " : ""
  var body = who + quote
  if (n > 1) body += " and " + (n - 1) + " more"
  body += " · " + s.open + " open"
  return { headline: headline, body: body }
}

// True when the oldest unanswered question has waited longer than `minutes`
// and no agent is on the session.
function questionIsStale(s, minutes, now) {
  if (!(minutes > 0) || !s.staleQuestionSince) return false
  if (s.agent && s.agent.state && s.agent.state !== "offline") return false
  var since = Date.parse(s.staleQuestionSince)
  if (!isFinite(since)) return false
  return (now || Date.now()) - since >= minutes * 60000
}

function staleNotification(s, minutes) {
  return {
    headline: "A question is waiting · " + title(s),
    body: "No agent has answered for " + minutes + (minutes === 1 ? " minute" : " minutes") + ". Click to send it to Claude Code."
  }
}

// The agent left after a round: what it did while it was here.
function roundDoneNotification(s, applied) {
  var body = (applied === 1 ? "1 comment applied" : applied + " comments applied") + " · " + s.open + " open"
  if (s.forYou > 0) body += " · " + s.forYou + " for you"
  return { headline: "Round done · " + title(s), body: body }
}

// "working" when any agent is on a comment, "online" when any is present, else "".
function agentState(sessions) {
  var state = ""
  for (var i = 0; i < sessions.length; i++) {
    var a = sessions[i].agent
    if (!a || !a.state || a.state === "offline") continue
    if (a.state === "working") return "working"
    state = "online"
  }
  return state
}

function forYouTotal(sessions) {
  var n = 0
  for (var i = 0; i < sessions.length; i++) n += sessions[i].forYou
  return n
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
  return "Local only. Start it with --tailscale, --tunnel, or --host 0.0.0.0 to reach it from a phone."
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
    activityLine: activityLine,
    ago: ago,
    desktopLine: desktopLine,
    newComments: newComments,
    recentIds: recentIds,
    typeWord: typeWord,
    newCommentNotification: newCommentNotification,
    questionIsStale: questionIsStale,
    staleNotification: staleNotification,
    roundDoneNotification: roundDoneNotification,
    agentState: agentState,
    forYouTotal: forYouTotal,
    openTotal: openTotal,
    summary: summary,
    phoneHint: phoneHint,
    parseQrMatrix: parseQrMatrix
  }
}
