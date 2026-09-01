import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// Polls bin/fbs-sessions for the review servers running on this machine, holds
// the parsed list, raises a desktop notification when a session gains a
// comment, checks that Node.js is available, and renders phone QR codes. All
// process work happens here; Widget.qml only draws.
Item {
  id: root

  property var settings: ({})
  property string binDir: ""
  property bool panelOpen: false

  property var sessions: []
  property int sessionCount: 0
  property int openTotal: 0
  property string summaryText: "No review running"
  property string lastError: ""
  property bool refreshing: false
  property bool everRefreshed: false
  property bool nodeMissing: false

  // QR state: which session it belongs to, and the matrix.
  property int qrPid: 0
  property string qrText: ""
  property var qrRows: []
  property int qrSize: 0
  property string qrError: ""
  property bool qrLoading: false

  // pid -> total comments at the last poll, for new-comment notifications.
  property var _seenTotals: ({})
  property bool _primed: false

  readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 5, 2, 60)
  readonly property bool notifyNewComments: setting("notifyNewComments", true) === true

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

  function refresh() {
    if (listProc.running || binDir === "") return
    refreshing = true
    listProc.command = ["bash", binDir + "/fbs-sessions"]
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
    var seen = {}
    for (var i = 0; i < next.length; i++) {
      var s = next[i]
      var previous = _seenTotals[s.pid]
      if (_primed && previous !== undefined && s.total > previous && notifyNewComments) notifyNewComment(s, s.total - previous)
      seen[s.pid] = s.total
    }
    _seenTotals = seen
    _primed = true
    sessions = next
    sessionCount = next.length
    openTotal = Model.openTotal(next)
    summaryText = Model.summary(next)
    // A QR for a session that ended is stale.
    if (qrPid !== 0 && !findSession(qrPid)) clearQr()
  }

  function findSession(pid) {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].pid === pid) return sessions[i]
    return null
  }

  function notifyNewComment(s, count) {
    var headline = count === 1 ? "New comment" : count + " new comments"
    var body = Model.title(s) + " · " + s.open + " open"
    var cmd = ["omarchy-notification-send", "--app-name", "Feedback Studio", "-g", "󰍩", "-u", "normal", headline, body]
    if (s.url) cmd = cmd.concat(["--exec", "omarchy-launch-browser", s.url])
    Quickshell.execDetached(cmd)
  }

  function checkNode() {
    if (nodeProc.running) return
    nodeProc.running = true
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

  onPanelOpenChanged: if (panelOpen) { refresh(); checkNode() }

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
