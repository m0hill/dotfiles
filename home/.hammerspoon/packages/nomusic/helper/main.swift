import AppKit

private let blockedBundleIdentifiers = Set([
    "com.apple.Music",
    "com.apple.iTunes",
])

private final class MusicBlocker: NSObject {
    private let workspace = NSWorkspace.shared
    private let replacement: URL?

    init(replacement: URL?) {
        self.replacement = replacement
    }

    func start() {
        workspace.notificationCenter.addObserver(
            self,
            selector: #selector(applicationWillLaunch(_:)),
            name: NSWorkspace.willLaunchApplicationNotification,
            object: nil
        )

        for application in workspace.runningApplications {
            block(application, openReplacement: false)
        }
    }

    @objc private func applicationWillLaunch(_ notification: Notification) {
        guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
            as? NSRunningApplication
        else {
            return
        }

        block(application, openReplacement: true)
    }

    private func block(_ application: NSRunningApplication, openReplacement: Bool) {
        guard let bundleIdentifier = application.bundleIdentifier,
              blockedBundleIdentifiers.contains(bundleIdentifier)
        else {
            return
        }

        _ = application.forceTerminate()

        if openReplacement, let replacement {
            workspace.open(replacement)
        }
    }
}

private func replacementURL(from value: String) -> URL {
    if let url = URL(string: value), url.scheme != nil {
        return url
    }
    return URL(fileURLWithPath: NSString(string: value).expandingTildeInPath)
}

private func usage() -> Never {
    FileHandle.standardError.write(Data("Usage: nomusic-helper watch [--replacement PATH_OR_URL]\n".utf8))
    exit(64)
}

private let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.first == "watch" else {
    usage()
}

var replacement: URL?
var index = 1
while index < arguments.count {
    guard arguments[index] == "--replacement", index + 1 < arguments.count else {
        usage()
    }
    replacement = replacementURL(from: arguments[index + 1])
    index += 2
}

private let blocker = MusicBlocker(replacement: replacement)
blocker.start()
print("nomusic-helper: blocking Apple Music and iTunes")
RunLoop.main.run()
