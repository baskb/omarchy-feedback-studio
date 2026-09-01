import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Feedback Studio in the Omarchy bar: one icon with an open-comment badge, and
// a panel that lists every running review session (counts, what the coding
// agent is doing), opens a session in the browser, shows a QR code so a phone
// can join, stops a session, and starts new ones (the demo, or a folder or .md
// picked in a terminal). The engine is the `feedback-studio` npm package; this
// widget only reads its per-user session registry and its local API.
Panel {
  id: root
  moduleName: "baskb.feedback-studio"
  ipcTarget: "baskb.feedback-studio"
  manageIpc: false

  // This file's folder, so bin/ scripts resolve wherever the plugin is installed.
  readonly property string pluginDir: {
    var url = String(Qt.resolvedUrl("."))
    if (url.indexOf("file://") === 0) url = url.substring(7)
    return url.replace(/\/+$/, "")
  }
  readonly property string binDir: pluginDir + "/bin"

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color accent: Color.accent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color iconColor: svc.sessionCount > 0 ? barForeground : Qt.darker(barForeground, 1.55)

  property bool cursorActive: false
  property int cursorIndex: 0

  function launchArgs(mode, target) {
    var cmd = ["bash", root.binDir + "/fbs-launch"]
    if (root.setting("useTunnel", false) === true) cmd.push("--tunnel")
    var custom = String(root.setting("serverCommand", "") || "").trim()
    if (custom !== "") cmd.push("--command", custom)
    var pickRoot = String(root.setting("pickRoot", "") || "").trim()
    if (pickRoot !== "") cmd.push("--root", pickRoot)
    cmd.push(mode)
    if (target) cmd.push(target)
    return cmd
  }

  function launch(mode, target) {
    Quickshell.execDetached(launchArgs(mode, target))
    root.close()
  }

  function openSession(s) {
    if (!s || !s.url) return
    Quickshell.execDetached(["omarchy-launch-browser", s.url])
    root.close()
  }

  function stopSession(s) {
    if (!s || !s.pid) return
    Quickshell.execDetached(["kill", "-TERM", String(s.pid)])
    afterStop.restart()
  }

  function openDocs() {
    Quickshell.execDetached(["omarchy-launch-browser", "https://github.com/baskb/feedback-studio#readme"])
    root.close()
  }

  function selectedSession() {
    if (svc.sessions.length === 0) return null
    return svc.sessions[Math.max(0, Math.min(cursorIndex, svc.sessions.length - 1))]
  }

  function moveCursor(dy) {
    cursorActive = true
    if (svc.sessions.length === 0) return
    cursorIndex = Math.max(0, Math.min(svc.sessions.length - 1, cursorIndex + dy))
  }

  function setCursor(index) {
    cursorActive = true
    cursorIndex = index
  }

  function toggleQr(s) {
    if (!s) return
    if (svc.qrPid === s.pid) svc.clearQr()
    else svc.showQr(s.pid)
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onOpenedChanged: {
    svc.panelOpen = opened
    if (opened) {
      cursorActive = false
      cursorIndex = 0
      if (panelFlick) panelFlick.contentY = 0
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    } else {
      svc.clearQr()
    }
  }

  Service {
    id: svc
    settings: root.settings
    binDir: root.binDir
  }

  Timer {
    id: afterStop
    interval: 600
    repeat: false
    onTriggered: svc.refresh()
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { svc.refresh(); return "ok" }
    function status(): string { return svc.summaryText }
    function demo(): string { root.launch("demo"); return "ok" }
    function pick(): string { root.launch("pick"); return "ok" }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰍩"
    tooltipText: svc.summaryText
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) svc.refresh()
      else if (buttonCode === Qt.MiddleButton) root.openSession(svc.sessions.length > 0 ? svc.sessions[0] : null)
      else root.toggle()
    }
  }

  // Open-comment count, tucked into the icon's corner.
  Rectangle {
    id: badge
    visible: svc.openTotal > 0
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.rightMargin: 1
    anchors.topMargin: root.vertical ? 1 : Math.max(1, Math.round((root.barSize - Style.bar.iconSlot) / 2))
    width: Math.max(implicitHeight, badgeText.implicitWidth + 4)
    height: implicitHeight
    implicitHeight: Math.round(Style.font.caption * 0.95) + 2
    radius: height / 2
    color: root.barForeground

    Text {
      id: badgeText
      anchors.centerIn: parent
      textFormat: Text.PlainText
      text: svc.openTotal > 99 ? "99+" : String(svc.openTotal)
      color: bar ? bar.background : Color.background
      font.family: root.fontFamily
      font.pixelSize: Math.round(Style.font.caption * 0.75)
      font.bold: true
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        root.moveCursor(dy)
      }
      onActivateRequested: if (root.cursorActive) root.openSession(root.selectedSession())
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "r" || t === "R") svc.refresh()
        else if (t === "d" || t === "D") root.launch("demo")
        else if (t === "o" || t === "O") root.launch("pick")
        else if (t === "q" || t === "Q") root.toggleQr(root.selectedSession())
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(12)

          PanelHero {
            id: hero
            width: parent.width
            title: "Feedback Studio"
            meta: svc.summaryText
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: svc.sessionCount > 0 ? 1.0 : 0.5
            iconComponent: Component {
              Text {
                text: "󰍩"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
              }
            }
            trailingControl: Component {
              PanelActionButton {
                iconText: "󰑐"
                tooltipText: "Refresh (R)"
                foreground: hero.foreground
                fontFamily: hero.fontFamily
                enabled: !svc.refreshing
                onClicked: svc.refresh()
              }
            }
          }

          Text {
            visible: svc.lastError !== ""
            width: parent.width
            textFormat: Text.PlainText
            text: svc.lastError
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Text {
            visible: svc.nodeMissing
            width: parent.width
            textFormat: Text.PlainText
            text: "Node.js was not found. Install it with:  mise use -g node@lts"
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // ---- sessions ----------------------------------------------------

          Column {
            width: parent.width
            spacing: Style.space(8)

            PanelSectionHeader {
              text: "SESSIONS"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Text {
              visible: svc.sessions.length === 0
              width: parent.width
              textFormat: Text.PlainText
              text: svc.everRefreshed
                ? "No review server is running. Start one below, or in any project with `npx feedback-studio`."
                : "Looking for sessions…"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              wrapMode: Text.WordWrap
            }

            Column {
              id: sessionColumn
              visible: svc.sessions.length > 0
              width: parent.width
              spacing: Style.space(4)

              Repeater {
                model: svc.sessions
                SessionRow {
                  required property var modelData
                  required property int index
                  width: sessionColumn.width
                  session: modelData
                  rowIndex: index
                }
              }
            }
          }

          // ---- phone QR ------------------------------------------------------

          Column {
            visible: svc.qrPid !== 0
            width: parent.width
            spacing: Style.space(10)

            PanelSeparator { foreground: root.foreground }

            PanelSectionHeader {
              text: "ON YOUR PHONE"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Rectangle {
              id: qrCanvas
              readonly property int moduleSize: svc.qrSize > 0
                ? Math.max(2, Math.floor(Style.space(220) / svc.qrSize))
                : 0
              visible: svc.qrSize > 0
              width: svc.qrSize * moduleSize
              height: width
              anchors.horizontalCenter: parent.horizontalCenter
              color: "white"
              radius: Style.cornerRadius

              Grid {
                anchors.fill: parent
                columns: svc.qrSize

                Repeater {
                  model: svc.qrSize * svc.qrSize
                  Rectangle {
                    required property int index
                    readonly property int matrixRow: Math.floor(index / svc.qrSize)
                    readonly property int matrixColumn: index % svc.qrSize
                    width: qrCanvas.moduleSize
                    height: qrCanvas.moduleSize
                    color: String(svc.qrRows[matrixRow] || "").charAt(matrixColumn) === "1" ? "#111111" : "transparent"
                  }
                }
              }
            }

            Text {
              visible: svc.qrLoading
              width: parent.width
              text: "Generating QR code…"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              horizontalAlignment: Text.AlignHCenter
            }

            Text {
              visible: svc.qrError !== ""
              width: parent.width
              textFormat: Text.PlainText
              text: svc.qrError
              color: root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
              horizontalAlignment: Text.AlignHCenter
            }

            Text {
              visible: svc.qrSize > 0
              width: parent.width
              textFormat: Text.PlainText
              text: "Scan to review from your phone, by voice or by touch."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
              horizontalAlignment: Text.AlignHCenter
            }

            Text {
              visible: svc.qrText !== ""
              width: parent.width
              textFormat: Text.PlainText
              text: svc.qrText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WrapAnywhere
              horizontalAlignment: Text.AlignHCenter
            }
          }

          // ---- start a review ----------------------------------------------

          Column {
            width: parent.width
            spacing: Style.space(8)

            PanelSeparator { foreground: root.foreground }

            PanelSectionHeader {
              text: "START A REVIEW"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Flow {
              width: parent.width
              spacing: Style.space(6)

              Button {
                text: "Open a folder or .md"
                iconText: "󰝰"
                tooltipText: "Pick a project folder or a Markdown file in a terminal (O)"
                bordered: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.launch("pick")
              }

              Button {
                text: "Demo"
                iconText: "󰐊"
                tooltipText: "Try Feedback Studio on a bundled sample page (D)"
                bordered: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.launch("demo")
              }

              Button {
                text: "Docs"
                iconText: "󰈙"
                tooltipText: "Open the Feedback Studio README"
                bordered: true
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.openDocs()
              }
            }

            Text {
              width: parent.width
              textFormat: Text.PlainText
              text: root.setting("useTunnel", false) === true
                ? "Sessions started here get a public HTTPS URL (--tunnel) for phone review."
                : "Turn on \"Phone-ready sessions\" in the widget settings to give new sessions a phone URL."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }
          }
        }
      }
    }
  }

  component SessionRow: CursorSurface {
    id: sessionRow
    property var session: null
    property int rowIndex: 0
    readonly property string agentText: session ? Model.agentLine(session) : ""
    readonly property bool hasPhone: session ? session.phoneUrl !== "" : false
    readonly property bool showingQr: session ? svc.qrPid === session.pid : false

    hasCursor: root.cursorActive && root.cursorIndex === rowIndex
    current: showingQr
    foreground: root.foreground

    implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: root.setCursor(sessionRow.rowIndex)
      onClicked: root.openSession(sessionRow.session)
    }

    RowLayout {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(6)
      spacing: Style.space(8)

      Text {
        textFormat: Text.PlainText
        text: sessionRow.session ? Model.modeGlyph(sessionRow.session.mode) : ""
        color: sessionRow.session && sessionRow.session.reachable ? root.foreground : root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
        Layout.alignment: Qt.AlignVCenter
      }

      ColumnLayout {
        Layout.fillWidth: true
        spacing: Style.space(1)

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: sessionRow.session ? Model.title(sessionRow.session) : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: sessionRow.session ? Model.countsLine(sessionRow.session) : ""
          color: sessionRow.session && sessionRow.session.open > 0 ? root.foreground : root.dim
          opacity: sessionRow.session && sessionRow.session.open > 0 ? 0.85 : 1
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: sessionRow.session ? Model.metaLine(sessionRow.session) : ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }

        Text {
          visible: sessionRow.agentText !== ""
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: "󰚩 " + sessionRow.agentText
          color: root.accent
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }

      PanelActionButton {
        iconText: "󰐲"
        tooltipText: sessionRow.hasPhone
          ? (sessionRow.showingQr ? "Hide the phone QR code (Q)" : "Show a QR code for your phone (Q)")
          : (sessionRow.session ? Model.phoneHint(sessionRow.session) : "")
        foreground: root.foreground
        fontFamily: root.fontFamily
        enabled: sessionRow.hasPhone
        Layout.alignment: Qt.AlignVCenter
        onClicked: root.toggleQr(sessionRow.session)
      }

      PanelActionButton {
        iconText: "󰏌"
        tooltipText: "Open in the browser (Enter)"
        foreground: root.foreground
        fontFamily: root.fontFamily
        Layout.alignment: Qt.AlignVCenter
        onClicked: root.openSession(sessionRow.session)
      }

      PanelActionButton {
        iconText: "󰓛"
        tooltipText: "Stop this session (comments stay on disk)"
        foreground: root.foreground
        hoverColor: root.urgent
        fontFamily: root.fontFamily
        Layout.alignment: Qt.AlignVCenter
        onClicked: root.stopSession(sessionRow.session)
      }
    }
  }
}
