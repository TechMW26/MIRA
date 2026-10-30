import AppKit
import ApplicationServices
import ScreenCaptureKit

var didOutput = false
var references: [String: AXUIElement] = [:]
func output(_ value: [String: Any]) { didOutput = true; let data = try! JSONSerialization.data(withJSONObject: value); print(String(data: data, encoding: .utf8)!); fflush(stdout) }
// Some installed apps prefix their display names with invisible bidi marks.
func appKey(_ name: String) -> String {
    String(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && ![0x200B, 0x200E, 0x200F, 0xFEFF].contains(Int($0.value)) }).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}
func installedAppMatches(_ name: String, roots: [String]) -> [URL] {
    let key = appKey(name).filter { $0.isLetter || $0.isNumber }
    guard !key.isEmpty else { return [] }
    var matches: [URL] = [], seen = Set<String>()
    // Include Chrome/Safari web apps and vendor subfolders, but never descend
    // into app bundles, symlinks or arbitrary user documents.
    func visit(_ root: URL, _ depth: Int) {
        guard depth <= 3, let entries = try? FileManager.default.contentsOfDirectory(at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles]) else { return }
        for url in entries.sorted(by: { $0.path < $1.path }) {
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values?.isDirectory == true, values?.isSymbolicLink != true else { continue }
            if url.pathExtension.lowercased() == "app" {
                let bundle = Bundle(url: url)
                let names = [url.deletingPathExtension().lastPathComponent,
                    bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "",
                    bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String ?? ""]
                if names.contains(where: { appKey($0).filter { $0.isLetter || $0.isNumber } == key }), seen.insert(url.standardizedFileURL.path).inserted { matches.append(url) }
            } else if url.pathExtension.isEmpty || url.pathExtension == "localized" { visit(url, depth + 1) }
        }
    }
    roots.forEach { visit(URL(fileURLWithPath: $0), 0) }
    return matches
}
let applicationRoots = [NSHomeDirectory() + "/Applications", "/Applications", "/System/Applications"]
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?; AXUIElementCopyAttributeValue(element, name as CFString, &value); return value
}
func windows(_ pid: pid_t) -> [AXUIElement] { attribute(AXUIElementCreateApplication(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [] }
func geometry(_ window: AXUIElement) -> [String: Double]? {
    guard let p = attribute(window, kAXPositionAttribute), let s = attribute(window, kAXSizeAttribute), CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point); AXValueGetValue(s as! AXValue, .cgSize, &size)
    return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
}
func resize(_ window: AXUIElement, _ frame: [String: Double]) -> Bool {
    guard let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"] else { return false }
    var point = CGPoint(x: x, y: y), size = CGSize(width: width, height: height)
    let p = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &point)!)
    let s = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
    return p == .success && s == .success
}
func execute(_ action: [String: Any]) {
    guard let type = action["type"] as? String else { return }
    // Display geometry requires neither Accessibility nor camera access.
    if type == "notch_geometry" {
        let id = action["displayId"] as? UInt32
        guard let display = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id }) else { output(["success": false]); return }
        let left = display.auxiliaryTopLeftArea, right = display.auxiliaryTopRightArea
        let width = display.safeAreaInsets.top > 0 ? max(0, (right?.minX ?? 0) - (left?.maxX ?? 0)) : 0
        output(["success": true, "displayId": id ?? 0, "notchWidth": width, "notchHeight": display.safeAreaInsets.top, "notchLeft": (left?.maxX ?? display.frame.midX) - display.frame.minX]); return
    }
    // A warm command-line helper blocks in readLine(), so NSWorkspace's
    // notification-backed frontmostApplication can remain on the old app.
    // Drain workspace notifications before reading focus. Some macOS versions
    // omit system-wide AXFocusedApplication for command-line helpers, so keep
    // the notification-refreshed workspace as a fallback, never a frozen cache.
    let workspace = NSWorkspace.shared
    RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    var focusedPid: pid_t = 0
    let focusedApp = attribute(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute)
    if let focusedApp { AXUIElementGetPid(focusedApp as! AXUIElement, &focusedPid) }
    let front = focusedPid > 0 ? NSRunningApplication(processIdentifier: focusedPid) : workspace.frontmostApplication
if let session = CGSessionCopyCurrentDictionary() as? [String: Any], session["CGSSessionScreenIsLocked"] as? Bool == true {
    output(["success": false, "message": "Unlock your Mac before using desktop controls."]); return
}
if type == "status" {
    let point = CGEvent(source:nil)?.location ?? .zero
    var result: [String: Any] = ["success": front != nil || !AXIsProcessTrusted(), "accessibility": AXIsProcessTrusted(), "app": front?.localizedName ?? "Unknown", "pid": front?.processIdentifier ?? 0,"x":point.x,"y":point.y]
    result["keyIdleSeconds"] = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
    if let pid = front?.processIdentifier, let focused = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute) {
        let window = focused as! AXUIElement
        if let index = windows(pid).firstIndex(where: { CFEqual($0, window) }), let frame = geometry(window) {
            result["windowId"] = "\(pid):\(index)"
            result["frame"] = frame
            result["center"] = ["x": frame["x"]! + frame["width"]! / 2, "y": frame["y"]! + frame["height"]! / 2]
        }
    }
    output(result); return
}
guard AXIsProcessTrusted() else { output(["success": false, "message": "Enable Accessibility for Talio in System Settings."]); return }
func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
    for down in [true, false] { let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down); event?.flags = flags; event?.post(tap: .cghidEventTap) }
}
switch type {
case "capture":
    // Use the same already-granted recording permission. Never prompt or bypass
    // TCC here; this is a fallback for empty Electron desktop thumbnails.
    guard CGPreflightScreenCaptureAccess(), let displayID = action["displayId"] as? UInt32 else {
        output(["success": false, "message": "Screen capture permission is unavailable."]); return
    }
    var captureResult: [String: Any]?
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, _ in
        guard let display = content?.displays.first(where: { $0.displayID == displayID }) else {
            DispatchQueue.main.async { captureResult = ["success": false, "message": "Requested display is unavailable."] }; return
        }
        let configuration = SCStreamConfiguration()
        let scale = min(1, min(1440 / display.frame.width, 900 / display.frame.height))
        configuration.width = max(1, Int(display.frame.width * scale))
        configuration.height = max(1, Int(display.frame.height * scale))
        configuration.showsCursor = false
        let filter = SCContentFilter(display: display, excludingWindows: [])
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, _ in
            let data = image.flatMap { NSBitmapImageRep(cgImage: $0).representation(using: .jpeg, properties: [.compressionFactor: 0.75]) }
            DispatchQueue.main.async {
                if let data, !data.isEmpty, data.count < 1400000 {
                    captureResult = ["success": true, "image": data.base64EncodedString()]
                } else { captureResult = ["success": false, "message": "macOS could not produce a screen image."] }
            }
        }
    }
    let deadline = Date().addingTimeInterval(6)
    while captureResult == nil && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
    output(captureResult ?? ["success": false, "message": "Screen capture timed out."]); return
case "ax_action":
    guard let ref = action["ref"] as? String, let element = references.removeValue(forKey: ref),
          let expectedPid = action["pid"] as? Int32, front?.processIdentifier == expectedPid,
          let expectedRole = action["role"] as? String, attribute(element, kAXRoleAttribute) as? String == expectedRole,
          attribute(element, kAXSubroleAttribute) as? String != "AXSecureTextField",
          attribute(element, "AXHidden") as? Bool != true, attribute(element, kAXEnabledAttribute) as? Bool != false,
          let oldFrame = action["frame"] as? [String: Double], let frame = geometry(element),
          frame.allSatisfy({ abs($0.value - (oldFrame[$0.key] ?? -99999)) < 2 }) else {
        output(["success": false, "notExecuted": true]); return
    }
    let label = [kAXTitleAttribute, kAXDescriptionAttribute, "AXPlaceholderValue"].compactMap { attribute(element, $0) as? String }.first(where: { !$0.isEmpty }) ?? ""
    guard String(label.prefix(100)) == action["label"] as? String else { output(["success": false, "notExecuted": true]); return }
    if action["operation"] as? String == "fill" {
        guard ["AXTextField", "AXTextArea", "AXSearchField"].contains(expectedRole), let text = action["text"] as? String, text.count <= 2000,
              !text.contains("\n"), !text.contains("\r") else { output(["success": false, "notExecuted": true]); return }
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue else { output(["success": false, "notExecuted": true]); return }
        let changed = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
        // Read only the specific non-secure field just written; never export its value.
        let verified = changed == .success && attribute(element, kAXValueAttribute) as? String == text
        output(["success": verified, "verified": verified, "message": verified ? "Field value verified." : "Field outcome uncertain; do not replay."]); return
    }
    var actions: CFArray?
    AXUIElementCopyActionNames(element, &actions)
    guard (actions as? [String] ?? []).contains(kAXPressAction) else { output(["success": false, "notExecuted": true]); return }
    let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
    output(["success": result == .success, "message": "Control invoked; verify the updated state."]); return
case "ui_elements":
    references.removeAll()
    guard let pid = front?.processIdentifier, let focused = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute) else { output(["success":false]); return }
    let root = focused as! AXUIElement
    AXUIElementSetMessagingTimeout(root, 0.15)
    var queue: [(AXUIElement, Int, Bool)] = [(root, 0, false)]
    if let menuBar = attribute(AXUIElementCreateApplication(pid), kAXMenuBarAttribute) {
        queue.insert((menuBar as! AXUIElement, 0, true), at: 0)
    }
    // Pop-up menus may live outside the focused window's AX children. Include
    // only the focused element's menu ancestry, not unrelated app windows.
    if let focus = attribute(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute) {
        var ancestor = focus as! AXUIElement
        for _ in 0..<8 {
            if attribute(ancestor, kAXRoleAttribute) as? String == "AXMenu" {
                queue.insert((ancestor, 0, true), at: 0)
                break
            }
            guard let parent = attribute(ancestor, kAXParentAttribute) else { break }
            ancestor = parent as! AXUIElement
        }
    }
    var elements: [[String:Any]] = []
    var seen: [AXUIElement] = []
    var visited = 0
    let deadline = Date().addingTimeInterval(0.8)
    while !queue.isEmpty && visited < 250 && Date() < deadline {
        let (element, depth, parentNavigation) = queue.removeFirst()
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        seen.append(element); visited += 1
        let role = attribute(element, kAXRoleAttribute) as? String ?? ""
        let navigation = parentNavigation || ["AXToolbar", "AXMenu", "AXMenuBar"].contains(role)
        let label = [kAXTitleAttribute, kAXDescriptionAttribute, "AXPlaceholderValue"].compactMap { attribute(element, $0) as? String }.first(where: { !$0.isEmpty }) ?? ""
        // Do not read AXValue or secure text; collect bounded visible labels only.
        if !label.isEmpty && role != "AXSecureTextField" && attribute(element, kAXSubroleAttribute) as? String != "AXSecureTextField",
           attribute(element, "AXHidden") as? Bool != true, attribute(element, kAXEnabledAttribute) as? Bool != false,
           let frame = geometry(element), frame["width"]! > 0, frame["height"]! > 0,
           ["AXButton", "AXTextField", "AXTextArea", "AXSearchField", "AXStaticText", "AXLink", "AXCheckBox", "AXPopUpButton", "AXMenuItem", "AXMenuBarItem"].contains(role) {
            let ref = UUID().uuidString
            references[ref] = element
            elements.append(["ref":ref, "role":role, "label":String(label.prefix(100)), "frame":frame, "navigation":navigation])
        }
        if depth < 12, role != "AXSecureTextField", let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children.prefix(100).map { ($0, depth + 1, navigation) })
        }
    }
    // Paragraphs must not crowd out late toolbar/menu/search controls.
    let controls = elements.filter { $0["role"] as? String != "AXStaticText" }
    let labels = elements.filter { $0["role"] as? String == "AXStaticText" }
    let visible = Array(controls.prefix(50)) + Array(labels.prefix(60 - min(50, controls.count)))
    output(["success":true,"pid":pid,"elements":visible]); return
case "prepare_window":
    guard let pid = front?.processIdentifier, let focused = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute) else { output(["success":false]); return }
    let window = focused as! AXUIElement
    guard let index = windows(pid).firstIndex(where: { CFEqual($0, window) }), let frame = geometry(window), attribute(window, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole else { output(["success":false]); return }
    if attribute(window, "AXFullScreen") as? Bool == true { output(["success":true]); return }
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    let center = CGPoint(x: frame["x"]! + frame["width"]! / 2, y: top - frame["y"]! - frame["height"]! / 2)
    guard let display = NSScreen.screens.first(where: { $0.frame.contains(center) }) else { output(["success":false]); return }
    let visible = display.visibleFrame
    let expanded: [String: Double] = ["x":Double(visible.minX), "y":Double(top - visible.maxY), "width":Double(visible.width), "height":Double(visible.height)]
    let success = resize(window, expanded)
    usleep(150000)
    output(["success":success, "state":["pid":pid,"index":index,"title":attribute(window, kAXTitleAttribute) as? String ?? "", "frame":frame,"expanded":geometry(window) ?? expanded]]); return
case "restore_window":
    guard let state = action["state"] as? [String:Any], let pid = state["pid"] as? Int32, let index = state["index"] as? Int, let frame = state["frame"] as? [String:Double], let expanded = state["expanded"] as? [String:Double] else { return }
    let list = windows(pid)
    // Do not undo a resize performed by the user while MIRA was active.
    if list.indices.contains(index), (attribute(list[index], kAXTitleAttribute) as? String ?? "") == state["title"] as? String, let current = geometry(list[index]), current.allSatisfy({ abs($0.value - (expanded[$0.key] ?? -99999)) < 3 }) { _ = resize(list[index], frame) }
    output(["success":true]); return
case "drag":
    guard let x = action["x"] as? Double, let y = action["y"] as? Double, let tx = action["toX"] as? Double, let ty = action["toY"] as? Double else { return }
    let start = CGPoint(x:x,y:y)
    CGEvent(mouseEventSource:nil, mouseType:.leftMouseDown, mouseCursorPosition:start, mouseButton:.left)?.post(tap:.cghidEventTap)
    for step in 1...30 {
        let t = Double(step) / 30
        CGEvent(mouseEventSource:nil, mouseType:.leftMouseDragged, mouseCursorPosition:CGPoint(x:x+(tx-x)*t,y:y+(ty-y)*t), mouseButton:.left)?.post(tap:.cghidEventTap)
        usleep(20000)
    }
    CGEvent(mouseEventSource:nil, mouseType:.leftMouseUp, mouseCursorPosition:CGPoint(x:tx,y:ty), mouseButton:.left)?.post(tap:.cghidEventTap)
case "click":
    guard let x = action["x"] as? Double, let y = action["y"] as? Double else { return }
    let point = CGPoint(x: x, y: y)
    let start = CGEvent(source: nil)?.location ?? point
    for step in 1...4 {
        let t = Double(step) / 4.0
        let eased = t * t * (3 - 2 * t)
        let intermediate = CGPoint(x: start.x + (point.x - start.x) * eased, y: start.y + (point.y - start.y) * eased)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: intermediate, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(8000)
    }
    for kind in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] { CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(10000) }
case "type":
    guard let text = action["text"] as? String, text.count <= 2000 else { return }
    // Catalyst apps (including WhatsApp) can ignore synthetic Unicode key
    // payloads. Paste into the verified focused field, preserving all clipboard
    // formats and never overwriting a concurrent user clipboard change.
    if appKey(front?.localizedName ?? "") != "whatsapp" {
        let chars = Array(text.utf16)
        for offset in stride(from: 0, to: chars.count, by: 20) {
            let chunk = Array(chars[offset..<min(offset + 20, chars.count)])
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
                event?.flags = []
                event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
                event?.post(tap: .cghidEventTap)
            }
        }
        usleep(50000)
        output(["success":true,"message":"Input delivered; verify the updated screen."])
        return
    }
    let board = NSPasteboard.general
    let previous = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
        let copy = NSPasteboardItem()
        for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
        return copy
    }
    board.clearContents()
    board.setString(text, forType: .string)
    let ownedChange = board.changeCount
    key(9, .maskCommand)
    usleep(300000)
    if board.changeCount == ownedChange {
        board.clearContents()
        if !previous.isEmpty { board.writeObjects(previous) }
    }
case "key":
    if action["key"] as? String == "open_location" { key(5, [.maskCommand, .maskShift]); break }
    let keys: [String: CGKeyCode] = ["space":49,"enter":36,"tab":48,"escape":53,"backspace":51,"up":126,"down":125,"left":123,"right":124,"select_all":0,"copy":8,"paste":9,"find":3]
    let shortcuts: [String: (CGKeyCode, CGEventFlags)] = [
        "app_switch": (48, .maskCommand), "app_search": (49, .maskCommand),
        "browser_address": (37, .maskCommand), "new_tab": (17, .maskCommand),
        "close_tab": (13, .maskCommand), "refresh": (15, .maskCommand),
        "save": (1, .maskCommand), "undo": (6, .maskCommand),
        "redo": (6, [.maskCommand, .maskShift])
    ]
    guard let name = action["key"] as? String else { return }
    if let (code, flags) = shortcuts[name] { key(code, flags); break }
    guard let code = keys[name] else { return }
    key(code, ["select_all","copy","paste","find"].contains(name) ? .maskCommand : [])
case "scroll":
    guard let amount = action["amount"] as? Int, abs(amount) <= 10 else { return }
    CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: Int32(-amount), wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
case "lock": key(12, [.maskCommand, .maskControl])
case "open_app":
    guard let name = action["name"] as? String else { return }
    if let running = NSWorkspace.shared.runningApplications.first(where: { appKey($0.localizedName ?? "") == appKey(name) && $0.activationPolicy == .regular }) {
        running.unhide()
        let application = AXUIElementCreateApplication(running.processIdentifier)
        var windowsValue: CFTypeRef?
        AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &windowsValue)
        for window in (windowsValue as? [AXUIElement]) ?? [] {
            AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
            AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        }
        let activated = running.activate(options: [.activateAllWindows])
        output(["success": activated, "message": activated ? "Existing application brought to front; verify the screen." : "Application could not be focused."])
        return
    }
    let matches = installedAppMatches(name, roots: applicationRoots)
    guard matches.count <= 1 else { output(["success":false,"notExecuted":true,"message":"Multiple installed apps match. Ask which application to use; do not choose a browser instead."]); return }
    guard let app = matches.first else { output(["success":false,"notInstalled":true,"notExecuted":true,"message":"No installed app matched in the application folders. Use app_search to inspect the device's app search results before choosing a web fallback."]); return }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    var completed = false
    NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
        output(["success":error == nil,"message":error == nil ? "Application opened." : "The application could not be opened."]); completed = true
    }
    let deadline = Date().addingTimeInterval(8)
    while !completed && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
    if !completed { output(["success": false, "message": "App activation timed out."]); exit(1) }
    return
default: output(["success":false]); return
}
usleep(50000)
output(["success":true,"message":"Input delivered; verify the updated screen."])

}
func handle(_ line: String) {
    didOutput = false
    if line.utf8.count <= 10000, let data = line.data(using: .utf8), let action = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { execute(action) }
    if !didOutput { output(["success": false, "message": "Invalid native action."]) }
}
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--serve" {
    while let line = readLine() { autoreleasepool { handle(line) } }
} else if CommandLine.arguments.count == 2 { handle(CommandLine.arguments[1]) }
