import AppKit
import Foundation
import UniformTypeIdentifiers

struct LaunchConfig {
    let port: Int
    let token: String
    let session: String
    let mode: String

    static func parse(arguments: [String]) -> LaunchConfig? {
        var values: [String: String] = [:]
        var index = 1
        while index < arguments.count {
            let arg = arguments[index]
            if arg.hasPrefix("--"), index + 1 < arguments.count {
                values[String(arg.dropFirst(2))] = arguments[index + 1]
                index += 2
            } else {
                index += 1
            }
        }

        guard
            let portText = values["port"],
            let port = Int(portText),
            let token = values["token"],
            let session = values["session"]
        else {
            return nil
        }

        return LaunchConfig(
            port: port,
            token: token,
            session: session,
            mode: values["mode"] ?? "all"
        )
    }
}

struct Choice: Decodable {
    let id: String
    let kind: String?
    let title: String
    let subtitle: String?
    let path: String?
    let iconHint: String?
    let disabled: Bool?
}

struct BackendResponse: Decodable {
    let ok: Bool?
    let error: String?
    let session: String?
    let mode: String?
    let query: String?
    let version: Int?
    let seq: Int?
    let searching: Bool?
    let choices: [Choice]?
}

struct QueryRequest: Encodable {
    let session: String
    let mode: String
    let query: String
    let seq: Int
}

struct PollRequest: Encodable {
    let session: String
    let version: Int
    let seq: Int
}

struct SelectRequest: Encodable {
    let session: String
    let id: String
}

struct CancelRequest: Encodable {
    let session: String
}

enum BackendError: Error {
    case invalidURL
    case noData
    case badStatus(Int, String)
}

final class BackendClient {
    private let port: Int
    private let token: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(port: Int, token: String) {
        self.port = port
        self.token = token
    }

    func post<RequestBody: Encodable>(
        _ path: String,
        body: RequestBody,
        timeout: TimeInterval = 1.5,
        completion: @escaping (Result<BackendResponse, Error>) -> Void
    ) {
        guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else {
            completion(.failure(BackendError.invalidURL))
            return
        }

        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = timeout
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            URLSession.shared.dataTask(with: request) { [decoder] data, response, error in
                if let error {
                    completion(.failure(error))
                    return
                }

                guard let http = response as? HTTPURLResponse else {
                    completion(.failure(BackendError.noData))
                    return
                }

                let data = data ?? Data()
                if !(200..<300).contains(http.statusCode) {
                    let message = String(data: data, encoding: .utf8) ?? ""
                    completion(.failure(BackendError.badStatus(http.statusCode, message)))
                    return
                }

                do {
                    completion(.success(try decoder.decode(BackendResponse.self, from: data)))
                } catch {
                    completion(.failure(error))
                }
            }.resume()
        } catch {
            completion(.failure(error))
        }
    }
}

final class LauncherPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class SearchTextField: NSTextField {
    var keyHandler: ((NSEvent) -> Bool)?

    override func keyDown(with event: NSEvent) {
        if keyHandler?(event) == true {
            return
        }
        super.keyDown(with: event)
    }
}

final class ResultRowView: NSTableRowView {
    override func drawSelection(in dirtyRect: NSRect) {
        guard selectionHighlightStyle != .none else { return }
        let rect = bounds.insetBy(dx: 10, dy: 3)
        let path = NSBezierPath(roundedRect: rect, xRadius: 10, yRadius: 10)
        NSColor.controlAccentColor.withAlphaComponent(0.22).setFill()
        path.fill()
    }
}

final class ResultCellView: NSTableCellView {
    static let identifier = NSUserInterfaceItemIdentifier("ResultCellView")

    private let iconView = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let subtitleLabel = NSTextField(labelWithString: "")
    private let textStack = NSStackView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        identifier = Self.identifier
        wantsLayer = true

        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.wantsLayer = true
        iconView.layer?.cornerRadius = 6
        iconView.layer?.masksToBounds = true

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.font = .systemFont(ofSize: 15, weight: .medium)
        titleLabel.textColor = .labelColor
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.maximumNumberOfLines = 1

        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.font = .systemFont(ofSize: 12)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.lineBreakMode = .byTruncatingTail
        subtitleLabel.maximumNumberOfLines = 1

        textStack.translatesAutoresizingMaskIntoConstraints = false
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 2
        textStack.addArrangedSubview(titleLabel)
        textStack.addArrangedSubview(subtitleLabel)

        addSubview(iconView)
        addSubview(textStack)

        NSLayoutConstraint.activate([
            iconView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
            iconView.centerYAnchor.constraint(equalTo: centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 32),
            iconView.heightAnchor.constraint(equalToConstant: 32),

            textStack.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 14),
            textStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -20),
            textStack.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(with choice: Choice) {
        titleLabel.stringValue = choice.title
        subtitleLabel.stringValue = choice.subtitle ?? ""
        subtitleLabel.isHidden = (choice.subtitle ?? "").isEmpty
        iconView.image = Self.icon(for: choice)
        alphaValue = choice.disabled == true ? 0.55 : 1.0
    }

    private static func icon(for choice: Choice) -> NSImage? {
        if let path = choice.path, !path.isEmpty {
            return NSWorkspace.shared.icon(forFile: path)
        }

        switch choice.iconHint ?? choice.kind ?? "" {
        case "url":
            return contentIcon(forFileType: "webloc")
        case "app":
            return contentIcon(forFileType: "app")
        case "file", "path":
            return contentIcon(forFileType: "txt")
        case "clip", "clipboard", "text":
            return NSImage(systemSymbolName: "doc.on.clipboard", accessibilityDescription: nil)
                ?? contentIcon(forFileType: "txt")
        default:
            return NSImage(systemSymbolName: "magnifyingglass", accessibilityDescription: nil)
                ?? contentIcon(forFileType: "txt")
        }
    }

    private static func contentIcon(forFileType fileType: String) -> NSImage {
        let type = UTType(filenameExtension: fileType) ?? .plainText
        return NSWorkspace.shared.icon(for: type)
    }
}

final class LauncherController: NSObject, NSWindowDelegate, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate {
    private let config: LaunchConfig
    private let client: BackendClient

    private var panel: LauncherPanel!
    private var searchField: SearchTextField!
    private var tableView: NSTableView!
    private var statusLabel: NSTextField!

    private var choices: [Choice] = []
    private var querySeq = 0
    private var currentVersion = 0
    private var isClosing = false
    private var debounceTimer: Timer?
    private var pollTimer: Timer?

    init(config: LaunchConfig) {
        self.config = config
        self.client = BackendClient(port: config.port, token: config.token)
        super.init()
    }

    func show() {
        buildWindow()
        panel.centerNearTop()
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeFirstResponder(searchField)
        sendQuery(immediate: true)
    }

    private func buildWindow() {
        let size = NSSize(width: 720, height: 620)
        panel = LauncherPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.delegate = self
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true

        let root = NSVisualEffectView()
        root.translatesAutoresizingMaskIntoConstraints = false
        root.material = .hudWindow
        root.blendingMode = .behindWindow
        root.state = .active
        root.wantsLayer = true
        root.layer?.cornerRadius = 18
        root.layer?.masksToBounds = true
        panel.contentView = root

        searchField = SearchTextField(string: "")
        searchField.translatesAutoresizingMaskIntoConstraints = false
        searchField.isBordered = false
        searchField.isBezeled = false
        searchField.drawsBackground = false
        searchField.focusRingType = .none
        searchField.font = .systemFont(ofSize: 26, weight: .regular)
        searchField.textColor = .labelColor
        searchField.placeholderString = config.mode == "clipboard" ? "Search clipboard history" : "Search apps, files, and clipboard"
        searchField.delegate = self
        searchField.keyHandler = { [weak self] event in
            self?.handleKey(event) == true
        }

        let separator = NSBox()
        separator.translatesAutoresizingMaskIntoConstraints = false
        separator.boxType = .separator

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.textColor = .tertiaryLabelColor
        statusLabel.alignment = .right

        tableView = NSTableView()
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.headerView = nil
        tableView.backgroundColor = .clear
        tableView.selectionHighlightStyle = .regular
        tableView.rowHeight = 54
        tableView.intercellSpacing = NSSize(width: 0, height: 2)
        tableView.dataSource = self
        tableView.delegate = self
        tableView.target = self
        tableView.doubleAction = #selector(activateSelection)
        tableView.allowsEmptySelection = false
        tableView.allowsMultipleSelection = false

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("main"))
        column.width = size.width
        column.minWidth = size.width
        column.resizingMask = .autoresizingMask
        tableView.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        tableView.addTableColumn(column)

        let scrollView = NSScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = false
        scrollView.borderType = .noBorder
        scrollView.documentView = tableView

        root.addSubview(searchField)
        root.addSubview(statusLabel)
        root.addSubview(separator)
        root.addSubview(scrollView)

        NSLayoutConstraint.activate([
            searchField.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 28),
            searchField.trailingAnchor.constraint(equalTo: statusLabel.leadingAnchor, constant: -16),
            searchField.topAnchor.constraint(equalTo: root.topAnchor, constant: 24),
            searchField.heightAnchor.constraint(equalToConstant: 36),

            statusLabel.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -28),
            statusLabel.centerYAnchor.constraint(equalTo: searchField.centerYAnchor),
            statusLabel.widthAnchor.constraint(equalToConstant: 100),

            separator.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            separator.topAnchor.constraint(equalTo: searchField.bottomAnchor, constant: 20),

            scrollView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: separator.bottomAnchor, constant: 8),
            scrollView.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -12)
        ])
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        switch commandSelector {
        case #selector(NSResponder.moveUp(_:)):
            moveSelection(delta: -1)
            return true
        case #selector(NSResponder.moveDown(_:)):
            moveSelection(delta: 1)
            return true
        case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
            activateSelection()
            return true
        case #selector(NSResponder.cancelOperation(_:)):
            cancelAndQuit()
            return true
        default:
            return false
        }
    }

    func controlTextDidChange(_ obj: Notification) {
        sendQuery(immediate: false)
    }

    private func sendQuery(immediate: Bool) {
        debounceTimer?.invalidate()
        let delay: TimeInterval = immediate ? 0 : 0.035
        debounceTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.performQuery()
        }
    }

    private func performQuery() {
        querySeq += 1
        let seq = querySeq
        let query = searchField.stringValue
        pollTimer?.invalidate()
        setStatus("…")

        let request = QueryRequest(session: config.session, mode: config.mode, query: query, seq: seq)
        client.post("/query", body: request, timeout: 2.0) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, seq == self.querySeq, !self.isClosing else { return }
                switch result {
                case .success(let response):
                    self.apply(response: response)
                case .failure:
                    self.showBackendError()
                }
            }
        }
    }

    private func poll() {
        let seq = querySeq
        let request = PollRequest(session: config.session, version: currentVersion, seq: seq)
        client.post("/poll", body: request, timeout: 1.0) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, seq == self.querySeq, !self.isClosing else { return }
                switch result {
                case .success(let response):
                    self.apply(response: response)
                case .failure:
                    self.setStatus("")
                }
            }
        }
    }

    private func apply(response: BackendResponse) {
        if response.ok == false {
            showBackendError(response.error)
            return
        }

        if let version = response.version, version > currentVersion {
            currentVersion = version
            if let choices = response.choices {
                updateChoices(choices)
            }
        }

        if response.searching == true {
            setStatus("…")
            schedulePoll()
        } else {
            setStatus("")
            pollTimer?.invalidate()
        }
    }

    private func schedulePoll() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.09, repeats: false) { [weak self] _ in
            self?.poll()
        }
    }

    private func updateChoices(_ newChoices: [Choice]) {
        let selectedId = selectedChoice()?.id
        choices = newChoices
        tableView.reloadData()

        if let selectedId, let index = choices.firstIndex(where: { $0.id == selectedId && $0.disabled != true }) {
            tableView.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        } else if let first = choices.firstIndex(where: { $0.disabled != true }) {
            tableView.selectRowIndexes(IndexSet(integer: first), byExtendingSelection: false)
        }
    }

    private func showBackendError(_ message: String? = nil) {
        let choice = Choice(
            id: "error",
            kind: "error",
            title: "Native launcher backend unavailable",
            subtitle: message ?? "Reload Hammerspoon or fall back to hs.chooser",
            path: nil,
            iconHint: "text",
            disabled: true
        )
        updateChoices([choice])
        setStatus("")
    }

    private func setStatus(_ text: String) {
        statusLabel.stringValue = text
    }

    private func handleKey(_ event: NSEvent) -> Bool {
        switch event.keyCode {
        case 53:
            cancelAndQuit()
            return true
        case 36, 76:
            activateSelection()
            return true
        case 125:
            moveSelection(delta: 1)
            return true
        case 126:
            moveSelection(delta: -1)
            return true
        default:
            return false
        }
    }

    private func moveSelection(delta: Int) {
        guard !choices.isEmpty else { return }
        let current = tableView.selectedRow >= 0 ? tableView.selectedRow : -1
        var index = current
        for _ in 0..<choices.count {
            index += delta
            if index < 0 { index = choices.count - 1 }
            if index >= choices.count { index = 0 }
            if choices[index].disabled != true {
                tableView.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
                tableView.scrollRowToVisible(index)
                return
            }
        }
    }

    private func selectedChoice() -> Choice? {
        let row = tableView.selectedRow
        guard row >= 0, row < choices.count else { return nil }
        return choices[row]
    }

    @objc private func activateSelection() {
        guard let choice = selectedChoice(), choice.disabled != true else { return }
        isClosing = true
        panel.orderOut(nil)
        pollTimer?.invalidate()
        debounceTimer?.invalidate()
        client.post("/select", body: SelectRequest(session: config.session, id: choice.id), timeout: 1.0) { _ in
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
    }

    private func cancelAndQuit() {
        guard !isClosing else { return }
        isClosing = true
        panel.orderOut(nil)
        pollTimer?.invalidate()
        debounceTimer?.invalidate()
        client.post("/cancel", body: CancelRequest(session: config.session), timeout: 0.5) { _ in
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            NSApp.terminate(nil)
        }
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        choices.count
    }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        54
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        ResultRowView()
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell = tableView.makeView(withIdentifier: ResultCellView.identifier, owner: self) as? ResultCellView
            ?? ResultCellView(frame: .zero)
        cell.configure(with: choices[row])
        return cell
    }

    func windowDidResignKey(_ notification: Notification) {
        if !isClosing {
            cancelAndQuit()
        }
    }
}

private extension LauncherPanel {
    func centerNearTop() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let screen else {
            center()
            return
        }

        let visible = screen.visibleFrame
        let frame = self.frame
        let x = visible.midX - frame.width / 2
        let y = min(visible.maxY - frame.height - 90, visible.midY - frame.height / 2 + 160)
        setFrameOrigin(NSPoint(x: x, y: max(visible.minY + 20, y)))
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: LauncherController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let config = LaunchConfig.parse(arguments: CommandLine.arguments) else {
            NSApp.terminate(nil)
            return
        }

        let controller = LauncherController(config: config)
        self.controller = controller
        controller.show()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
