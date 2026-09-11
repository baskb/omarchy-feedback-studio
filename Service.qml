import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Polls bin/fbs-sessions for the review servers running on this machine, holds
// the parsed list, raises desktop notifications (a new comment, a question
// nobody answers, an agent finishing a round), checks that Node.js is
// available, reads the recent-projects list, and renders phone QR codes. All
// process work happens here; Widget.qml only draws.
Item {
  id: root

  property var settings: ({})
  property string binDir: ""
  property bool panelOpen: false

  property var sessions: []
  property int sessionCount: 0
  property int openTotal: 0
  property int forYouTotal: 0
  // "" | "online" | "working": the busiest agent across sessions, for the icon dot.
  property string agentState: ""
  // Sessions with a question that has waited too long without an agent.
  property int staleTotal: 0
  property string summaryText: "No review running"
  property string lastError: ""
  property bool refreshing: false
  property bool everRefreshed: false
  property bool nodeMissing: false
  property var recentProjects: []
  // Refreshed with every poll, so relative times in the rows stay honest.
  property double now: Date.now()

  // QR state: which session it belongs to, and the matrix.
  property int qrPid: 0
  property string qrText: ""
  property var qrRows: []
  property int qrSize: 0
  property string qrError: ""
  property bool qrLoading: false

  // pid -> comment ids seen at the last poll, for new-comment notifications.
  property var _seenIds: ({})
  // pid -> { state, resolved } of the agent at the last poll, for "round done".
  property var _agentSeen: ({})
  // pid -> true once the stale-question toast went out; cleared when answered.
  property var _staleNotified: ({})
  property bool _primed: false

  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 5, 2, 60)
  readonly property bool notifyNewComments: setting("notifyNewComments", true) === true
  readonly property bool notifyRoundDone: setting("notifyRoundDone", true) === true
  readonly property int questionStaleMin: intSetting("questionStaleMin", 10, 0, 240)
  readonly property string phoneAccess: phoneAccessSetting()
  readonly property bool clickSendsToClaude: String(setting("notifyClick", "Open the page")).indexOf("Claude") !== -1

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  function intSetting(name, fallback, min, max) {
    var n = parseInt(String(setting(name, fallback)), 10)
    if (!isFinite(n)) n = fallback
    if (n < min) n = min
    if (n > max) n = max
    return n
  }

  // "off" | "tailscale" | "tunnel". The old boolean useTunnel still counts.
  function phoneAccessSetting() {
    var v = String(setting("phoneAccess", "Off")).toLowerCase()
    if (v.indexOf("tailscale") !== -1) return "tailscale"
    if (v.indexOf("tunnel") !== -1) return "tunnel"
    if (setting("useTunnel", false) === true) return "tunnel"
    return "off"
  }

  function refresh() {
    if (listProc.running || binDir === "") return
    refreshing = true
    var cmd = ["bash", binDir + "/fbs-sessions"]
    if (phoneAccess === "tailscale") cmd.push("--phone", "tailscale")
    listProc.command = cmd
    listProc.running = true
  }

  function applySessions(raw) {
    var parsed = Model.parseSessions(raw)
    if (!parsed.ok) {
      lastError = parsed.error
      return
    }
    lastError = ""
    var next = parsed.sessions
    var now = Date.now()
    root.now = now
    var seenIds = {}
    var agentSeen = {}
    var staleNotified = {}
    var stale = 0
    for (var i = 0; i < next.length; i++) {
      var s = next[i]
      var previousIds = _seenIds[s.pid]
      if (_primed && previousIds !== undefined && notifyNewComments) {
        var fresh = Model.newComments(s, previousIds)
        if (fresh.length > 0) notifyNewComment(s, fresh)
      }
      seenIds[s.pid] = recentOrCarry(s, previousIds)

      var state = s.agent && s.agent.state ? s.agent.state : "offline"
      var was = _agentSeen[s.pid]
      if (was && was.state !== "offline" && state === "offline") {
        var applied = s.resolved - was.resolved
        if (applied > 0 && notifyRoundDone) notifyRoundDone_(s, applied)
      }
      // Remember the resolved count from the moment the agent showed up.
      agentSeen[s.pid] = (was && was.state !== "offline" && state !== "offline")
        ? { state: state, resolved: was.resolved }
        : { state: state, resolved: s.resolved }

      if (Model.questionIsStale(s, questionStaleMin, now)) {
        stale++
        if (!_staleNotified[s.pid] && _primed) notifyStale(s)
        staleNotified[s.pid] = true
      }
    }
    _seenIds = seenIds
    _agentSeen = agentSeen
    _staleNotified = staleNotified
    _primed = true
    sessions = next
    sessionCount = next.length
    openTotal = Model.openTotal(next)
    forYouTotal = Model.forYouTotal(next)
    agentState = Model.agentState(next)
    staleTotal = stale
    summaryText = Model.summary(next)
    // A QR for a session that ended is stale.
    if (qrPid !== 0 && !findSession(qrPid)) clearQr()
  }

  // The ids to remember for the next diff. An unreachable poll returns no
  // comments; keep the previous ids then, or every comment would look new
  // once the server answers again.
  function recentOrCarry(s, previousIds) {
    if (!s.reachable && previousIds !== undefined) return previousIds
    var ids = Model.recentIds(s)
    // Keep older ids too, so a burst of more than five comments in one poll
    // is still diffed against everything seen before, not only the last five.
    if (previousIds !== undefined) for (var k in previousIds) ids[k] = true
    return ids
  }

  function findSession(pid) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].pid === pid) return sessions[i]
    return null
  }

  function notifyCommand(headline, body, urgency) {
    return ["omarchy-notification-send", "--app-name", "Feedback Studio", "-g", "󰍩", "-u", urgency || "normal", headline, body]
  }

  function notifyNewComment(s, fresh) {
    var n = Model.newCommentNotification(s, fresh)
    var cmd = notifyCommand(n.headline, n.body)
    if (clickSendsToClaude && s.pid) cmd = cmd.concat(["--exec", "bash", binDir + "/fbs-process", String(s.pid)])
    else if (s.url) cmd = cmd.concat(["--exec", "omarchy-launch-browser", s.url])
    Quickshell.execDetached(cmd)
  }

  function notifyRoundDone_(s, applied) {
    var n = Model.roundDoneNotification(s, applied)
    var cmd = notifyCommand(n.headline, n.body)
    if (s.url) cmd = cmd.concat(["--exec", "omarchy-launch-browser", s.url])
    Quickshell.execDetached(cmd)
  }

  function notifyStale(s) {
    var n = Model.staleNotification(s, questionStaleMin)
    var cmd = notifyCommand(n.headline, n.body, "critical")
    if (s.pid) cmd = cmd.concat(["--exec", "bash", binDir + "/fbs-process", String(s.pid), "watch"])
    Quickshell.execDetached(cmd)
  }

  function checkNode() {
    if (nodeProc.running) return
    nodeProc.running = true
  }

  function loadRecent() {
    if (recentProc.running || binDir === "") return
    recentProc.running = true
  }

  function applyRecent(raw) {
    var list = []
    try { list = JSON.parse(String(raw || "").trim() || "[]") } catch (e) { list = [] }
    if (!Array.isArray(list)) list = []
    var out = []
    for (var i = 0; i < list.length; i++) {
      var r = list[i] && typeof list[i] === "object" ? list[i] : {}
      if (!r.path) continue
      out.push({ path: String(r.path), name: String(r.name || r.path), kind: String(r.kind || "folder"), at: Number(r.at) || 0 })
    }
    recentProjects = out
  }

  function showQr(pid) {
    var s = findSession(pid)
    if (!s || !s.phoneUrl) return
    if (qrProc.running) qrProc.running = false
    qrPid = pid
    qrText = s.phoneUrl
    qrRows = []
    qrSize = 0
    qrError = ""
    qrLoading = true
    qrProc.command = ["bash", binDir + "/fbs-qr", s.phoneUrl]
    qrProc.running = true
  }

  function clearQr() {
    if (qrProc.running) qrProc.running = false
    // Size first: the grid binds its cell count to it, so shrinking it before
    // the rows go away keeps every cell's row lookup valid.
    qrSize = 0
    qrRows = []
    qrPid = 0
    qrText = ""
    qrError = ""
    qrLoading = false
  }

  function applyQr(raw) {
    var matrix = Model.parseQrMatrix(raw)
    qrRows = matrix.rows
    qrSize = matrix.size
    if (qrSize === 0 && qrError === "") qrError = "Could not generate the QR code"
  }

  Timer {
    interval: root.panelOpen ? 2000 : root.refreshIntervalSec * 1000
    running: root.binDir !== ""
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  onPanelOpenChanged: if (panelOpen) { refresh(); checkNode(); loadRecent() }

  Process {
    id: listProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applySessions(text)
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var msg = String(text || "").trim()
        if (msg !== "") console.warn("feedback-studio widget: " + msg)
      }
    }
    onExited: function(exitCode) {
      root.refreshing = false
      root.everRefreshed = true
      if (exitCode !== 0 && root.lastError === "") root.lastError = "Session list failed (exit " + exitCode + ")"
    }
  }

  // Node.js is a prerequisite Omarchy does not ship; mise provides it. Report
  // its absence in the panel before the user clicks a launch button.
  Process {
    id: nodeProc
    command: ["bash", "-c", "command -v node >/dev/null 2>&1 || eval \"$(mise env -s bash 2>/dev/null)\"; command -v node >/dev/null 2>&1"]
    onExited: function(exitCode) { root.nodeMissing = exitCode !== 0 }
  }

  Process {
    id: recentProc
    command: ["bash", root.binDir + "/fbs-recent", "list"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applyRecent(text)
    }
  }

  Process {
    id: qrProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (root.qrPid !== 0) root.applyQr(text)
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var msg = String(text || "").trim()
        if (msg !== "" && root.qrPid !== 0) root.qrError = msg
      }
    }
    onExited: function(exitCode) {
      root.qrLoading = false
      if (exitCode !== 0 && root.qrSize === 0 && root.qrError === "") root.qrError = "Could not generate the QR code"
    }
  }
}
