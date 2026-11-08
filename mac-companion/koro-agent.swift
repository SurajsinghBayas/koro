// Koro Mac agent: clipboard sync, remote control from the phone, and a menu-bar remote for the phone.
//   * Mac → phone: text you copy is sent to the phone (passwords from password managers are skipped).
//   * phone → Mac: clipboard text, links (opened in your browser), and commands: lock, sleep, screen off,
//     play/pause/next/prev, volume, mute, brightness, keep awake, ring (find my Mac), open an app.
//     Volume/brightness changes show an on-screen bar like the keyboard keys do.
//   * menu bar (phone icon): play/pause/next on the phone, its volume, find my phone, send clipboard or the
//     current browser tab to the phone, clipboard sync on/off.
// Built and kept running by koro-mac.sh (launchd, KeepAlive). Reads SERVER/TOKEN (and CLIP_SYNC=0 to pause) from ~/.koro.
import AppKit
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
func log(_ s: String) { print("[\(ISO8601DateFormatter().string(from: Date()))] \(s)") }

// ---------- config ----------
func readConf() -> [String: String] {
    let path = NSHomeDirectory() + "/.koro"
    guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return [:] }
    var out: [String: String] = [:]
    for line in text.split(separator: "\n") {
        let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
        if parts.count == 2 { out[parts[0].trimmingCharacters(in: .whitespaces)] = parts[1].trimmingCharacters(in: .whitespaces) }
    }
    return out
}
var conf = readConf()
let server: String = conf["SERVER"] ?? ""
let token: String = conf["TOKEN"] ?? ""
if server.isEmpty || token.isEmpty { log("not paired: run koro-mac.sh pair first"); exit(1) }
func clipSyncOn() -> Bool { readConf()["CLIP_SYNC"] != "0" }
func setClipSync(_ on: Bool) {
    let path = NSHomeDirectory() + "/.koro"
    var lines = ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init).filter { !$0.hasPrefix("CLIP_SYNC=") }
    if !on { lines.append("CLIP_SYNC=0") }
    try? (lines.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
}

let nsapp = NSApplication.shared
nsapp.setActivationPolicy(.accessory) // menu-bar only, no Dock icon

// ---------- HTTP ----------
func request(_ method: String, _ path: String, body: [String: Any]? = nil, timeout: TimeInterval = 20) -> [String: Any]? {
    guard let url = URL(string: server + path) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
    if let body { req.setValue("application/json", forHTTPHeaderField: "content-type"); req.httpBody = try? JSONSerialization.data(withJSONObject: body) }
    let sem = DispatchSemaphore(value: 0)
    var out: [String: Any]?
    URLSession.shared.dataTask(with: req) { data, resp, err in
        if let err { log("\(method) \(path): \(err.localizedDescription)") }
        else if let code = (resp as? HTTPURLResponse)?.statusCode, code >= 400 { log("\(method) \(path): HTTP \(code)") }
        else if let data { out = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
        sem.signal()
    }.resume()
    sem.wait()
    return out
}

// ---------- helpers ----------
@discardableResult func osa(_ script: String) -> String? {
    if !Thread.isMainThread { return DispatchQueue.main.sync { osa(script) } } // NSAppleScript is main-thread only
    var err: NSDictionary?
    let r = NSAppleScript(source: script)?.executeAndReturnError(&err)
    if let err { log("applescript: \(err[NSAppleScript.errorMessage] ?? err)") }
    return r?.stringValue
}
func notifyMac(_ title: String, _ body: String) {
    let esc = { (s: String) in s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
    osa("display notification \"\(esc(String(body.prefix(200))))\" with title \"\(esc(title))\"")
}
func shell(_ path: String, _ args: [String]) {
    let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = args
    try? p.run(); p.waitUntilExit()
}

// Media keys via the system's MediaRemote (works for Spotify, Music, browsers); AppleScript fallback for Spotify/Music.
typealias MRSend = @convention(c) (UInt32, CFDictionary?) -> Bool
let mediaRemote: MRSend? = {
    guard let h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW),
          let sym = dlsym(h, "MRMediaRemoteSendCommand") else { return nil }
    return unsafeBitCast(sym, to: MRSend.self)
}()
func media(_ cmd: String) {
    let code: UInt32 = cmd == "toggle" ? 2 : cmd == "next" ? 4 : 5
    let verb = cmd == "toggle" ? "playpause" : cmd == "next" ? "next track" : "previous track"
    defer { DispatchQueue.global().asyncAfter(deadline: .now() + 0.8) { lastMacMedia = ""; watchMacMedia() } }
    // Music / Spotify playing: talk to it directly (always works)
    if macMediaSource == "Spotify" || macMediaSource == "Music" { osa("tell application \"\(macMediaSource)\" to \(verb)"); return }
    // anything else (a browser tab): the keyboard media key, else the system's media remote
    if mediaKey(cmd) { return }
    if let send = mediaRemote, send(code, nil) { return }
    for app in ["Spotify", "Music"] where running(app == "Spotify" ? "com.spotify.client" : "com.apple.Music") {
        osa("tell application \"\(app)\" to \(verb)"); return
    }
}

// ---------- what's playing on the Mac (synced to the phone) ----------
typealias MRInfo = @convention(c) (DispatchQueue, @escaping ([String: Any]) -> Void) -> Void
let mrInfo: MRInfo? = {
    guard let h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW),
          let sym = dlsym(h, "MRMediaRemoteGetNowPlayingInfo") else { return nil }
    return unsafeBitCast(sym, to: MRInfo.self)
}()
var macMediaSource = ""   // app name of what we last reported, so play/pause goes to the right place
func running(_ id: String) -> Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty }

/// Is this app making sound right now? Reads power assertions (each one is a block of lines: the owner, then
/// "Created for PID: n." and resources). Safari/WebKit name the app ("application.com.apple.Safari… Media Playback").
func makingSound(_ bundleId: String) -> Bool {
    let pids = Set(NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).map { $0.processIdentifier })
    let p = Process(), out = Pipe(); p.executableURL = URL(fileURLWithPath: "/usr/bin/pmset"); p.arguments = ["-g", "assertions"]; p.standardOutput = out
    guard (try? p.run()) != nil else { return false }
    let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""; p.waitUntilExit()
    var blocks: [String] = [], cur = ""
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("   pid ") { if !cur.isEmpty { blocks.append(cur) }; cur = String(line) } else { cur += "\n" + line }
    }
    blocks.append(cur)
    return blocks.contains { b in
        let low = b.lowercased()
        guard low.contains("media playback") || low.contains("playing audio") || low.contains("audio-out") || low.contains("video") else { return false }
        if b.contains("application.\(bundleId).") { return true }
        return pids.contains { b.contains("Created for PID: \($0).") || b.contains("pid \($0)(") }
    }
}

/// "(500) Pal Pal (with Talwiinder) | YouTube Music" → ("Pal Pal (with Talwiinder)", "")
func cleanTabTitle(_ t: String) -> (String, String) {
    var s = t.replacingOccurrences(of: #"^\(\d+\)\s*"#, with: "", options: .regularExpression)
    for suf in [" | YouTube Music", " - YouTube Music", " - YouTube", " | Spotify", " - Spotify", " | SoundCloud", " | JioSaavn", " – Apple Music", " - Apple Music"] where s.hasSuffix(suf) {
        s = String(s.dropLast(suf.count))
    }
    if s.hasPrefix("Spotify – ") { s = String(s.dropFirst(10)) }
    let parts = s.components(separatedBy: " • ")
    return parts.count > 1 ? (parts[0], parts[1]) : (s, "")
}

/// Media pages, best first: a YouTube Music song beats a parked YouTube video.
let mediaSites: [(String, String)] = [("music.youtube.com", "YouTube Music"), ("open.spotify.com", "Spotify"), ("music.apple.com", "Apple Music"),
                                      ("soundcloud.com", "SoundCloud"), ("jiosaavn.com", "JioSaavn"), ("youtube.com/watch", "YouTube")]

func nowPlayingMac() -> [String: Any]? {
    var found: [[String: Any]] = []
    // 1) the system's Now Playing (only answers on macOS versions that still allow it)
    if let get = mrInfo {
        var info: [String: Any] = [:]
        let sem = DispatchSemaphore(value: 0)
        get(DispatchQueue.global()) { info = $0; sem.signal() }
        _ = sem.wait(timeout: .now() + 1.5)
        if let t = info["kMRMediaRemoteNowPlayingInfoTitle"] as? String, !t.isEmpty {
            return ["title": t, "artist": info["kMRMediaRemoteNowPlayingInfoArtist"] as? String ?? "", "app": "Mac",
                    "playing": ((info["kMRMediaRemoteNowPlayingInfoPlaybackRate"] as? Double) ?? 0) > 0]
        }
    }
    // 2) Music / Spotify apps
    for (id, app) in [("com.spotify.client", "Spotify"), ("com.apple.Music", "Music")] where running(id) {
        let extra = app == "Spotify" ? " & \"\t\" & artwork url of current track" : ""
        if let r = osa("tell application \"\(app)\" to if player state is not stopped then return (player state as string) & \"\t\" & name of current track & \"\t\" & artist of current track\(extra)"),
           !r.isEmpty {
            let f = r.components(separatedBy: "\t")
            if f.count >= 3 { found.append(["title": f[1], "artist": f[2], "app": app, "playing": f[0] == "playing", "art": f.count > 3 ? f[3] : ""]) }
        }
    }
    // 3) a media tab in a browser (playing = that browser is making sound)
    let browsers = [("com.apple.Safari", "Safari"), ("com.google.Chrome", "Google Chrome"), ("company.thebrowser.Browser", "Arc"), ("com.brave.Browser", "Brave Browser")]
    for (id, name) in browsers where running(id) {
        let titleProp = id == "com.apple.Safari" ? "name" : "title" // Safari tabs call it "name"
        let script = """
        set out to ""
        tell application "\(name)"
          repeat with w in windows
            repeat with t in tabs of w
              set u to URL of t
              if u contains "youtube.com" or u contains "spotify.com" or u contains "music.apple.com" or u contains "soundcloud.com" or u contains "jiosaavn.com" then set out to out & u & "\t" & (\(titleProp) of t) & "\n"
            end repeat
          end repeat
        end tell
        return out
        """
        guard let r = osa(script), !r.isEmpty else { continue }
        let tabs = r.split(separator: "\n").map { $0.components(separatedBy: "\t") }.filter { $0.count > 1 }
        let sound = makingSound(id)
        for (site, label) in mediaSites {
            guard let t = tabs.first(where: { $0[0].contains(site) }) else { continue }
            let (title, artist) = cleanTabTitle(t[1])
            if title.isEmpty || title == label || title == "YouTube" { continue } // e.g. YT Music home with nothing loaded
            found.append(["title": title, "artist": artist, "app": "\(label) · \(name)", "url": t[0], "playing": sound, "browser": name])
            break
        }
    }
    // whatever is actually playing wins; otherwise the first paused thing
    return found.first { ($0["playing"] as? Bool) == true } ?? found.first
}

var lastMacMedia = "", lastMacMediaAt = Date.distantPast
func watchMacMedia() {
    let np = nowPlayingMac()
    macMediaSource = (np?["browser"] as? String) ?? (np?["app"] as? String) ?? ""
    let key = np.map { "\($0["title"] ?? "")|\($0["artist"] ?? "")|\($0["playing"] ?? "")" } ?? "none"
    if key == lastMacMedia && Date().timeIntervalSince(lastMacMediaAt) < 60 { return }
    lastMacMedia = key; lastMacMediaAt = Date()
    _ = request("POST", "/v1/mac/media", body: np ?? ["title": ""])
}

/// The keyboard play/pause/next/prev key (needs Accessibility permission; used for browsers).
func mediaKey(_ cmd: String) -> Bool {
    guard AXIsProcessTrusted() else { return false }
    let key: Int = cmd == "toggle" ? 16 : cmd == "next" ? 17 : 18 // NX_KEYTYPE_PLAY / NEXT / PREVIOUS
    for down in [true, false] {
        let flags = NSEvent.ModifierFlags(rawValue: down ? 0xa00 : 0xb00)
        let data1 = (key << 16) | ((down ? 0xa : 0xb) << 8)
        NSEvent.otherEvent(with: .systemDefined, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0,
                           context: nil, subtype: 8, data1: data1, data2: -1)?.cgEvent?.post(tap: .cghidEventTap)
    }
    return true
}

typealias LockFn = @convention(c) () -> Void
func lockScreen() {
    if let h = dlopen("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", RTLD_NOW),
       let sym = dlsym(h, "SACLockScreenImmediate") {
        unsafeBitCast(sym, to: LockFn.self)(); return
    }
    shell("/usr/bin/pmset", ["displaysleepnow"]) // locks when "require password immediately" is on
}

// ---------- brightness (built-in display, via DisplayServices; no permissions needed) ----------
typealias DSGet = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
typealias DSSet = @convention(c) (UInt32, Float) -> Int32
let ds = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW)
let dsGet: DSGet? = ds.flatMap { dlsym($0, "DisplayServicesGetBrightness") }.map { unsafeBitCast($0, to: DSGet.self) }
let dsSet: DSSet? = ds.flatMap { dlsym($0, "DisplayServicesSetBrightness") }.map { unsafeBitCast($0, to: DSSet.self) }
func brightness() -> Int? {
    var v: Float = 0
    guard let g = dsGet, g(CGMainDisplayID(), &v) == 0 else { return nil }
    return Int((v * 100).rounded())
}
func setBrightness(_ pct: Int) {
    let v = Float(max(0, min(100, pct))) / 100
    _ = dsSet?(CGMainDisplayID(), v)
}

// ---------- keep awake / ring / open app ----------
var caffeinate: Process?
func setAwake(_ on: Bool) {
    if on, caffeinate == nil {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/caffeinate"); p.arguments = ["-dis"]
        try? p.run(); caffeinate = p
    } else if !on { caffeinate?.terminate(); caffeinate = nil }
}
func ringMac() {
    DispatchQueue.main.async {
        notifyMac("Find my Mac", "Your phone is looking for this Mac")
        var n = 0
        Timer.scheduledTimer(withTimeInterval: 0.9, repeats: true) { t in
            NSSound(named: "Glass")?.play(); n += 1
            if n >= 8 { t.invalidate() }
        }
    }
}
func openApp(_ name: String) {
    guard name.range(of: #"^[\w .&'+-]{1,60}$"#, options: .regularExpression) != nil else { return }
    shell("/usr/bin/open", ["-a", name])
}

// ---------- on-screen bar (like the keyboard's volume / brightness HUD) ----------
final class Bars: NSView {
    var value: Double = 0
    override func draw(_ dirtyRect: NSRect) {
        let n = 16, gap: CGFloat = 3
        let w = (bounds.width - gap * CGFloat(n - 1)) / CGFloat(n)
        for i in 0..<n {
            let r = NSRect(x: CGFloat(i) * (w + gap), y: 0, width: w, height: bounds.height)
            (Double(i) < value * Double(n) - 0.01 ? NSColor.white : NSColor.white.withAlphaComponent(0.18)).setFill()
            NSBezierPath(roundedRect: r, xRadius: 1.5, yRadius: 1.5).fill()
        }
    }
}
final class HUD {
    static let shared = HUD()
    let panel: NSPanel
    let icon = NSImageView()
    let label = NSTextField(labelWithString: "")
    let bars = Bars()
    var hideWork: DispatchWorkItem?
    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 66), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .statusBar; panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.ignoresMouseEvents = true; panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        let fx = NSVisualEffectView(frame: panel.contentView!.bounds)
        fx.material = .hudWindow; fx.state = .active; fx.blendingMode = .behindWindow
        fx.wantsLayer = true; fx.layer?.cornerRadius = 18; fx.layer?.masksToBounds = true; fx.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(fx)
        icon.frame = NSRect(x: 16, y: 17, width: 32, height: 32); icon.contentTintColor = .white
        label.frame = NSRect(x: 60, y: 36, width: 220, height: 18); label.textColor = .white; label.font = .systemFont(ofSize: 13, weight: .semibold)
        bars.frame = NSRect(x: 60, y: 16, width: 222, height: 10)
        [icon, label, bars].forEach { fx.addSubview($0) }
    }
    /// value 0…1; kind "volume" | "brightness" | "muted"
    func show(_ kind: String, _ value: Double) {
        DispatchQueue.main.async { [self] in
            let sym = kind == "brightness" ? "sun.max.fill" : kind == "muted" || value <= 0 ? "speaker.slash.fill" : value < 0.34 ? "speaker.wave.1.fill" : value < 0.67 ? "speaker.wave.2.fill" : "speaker.wave.3.fill"
            icon.image = NSImage(systemSymbolName: sym, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: 22, weight: .medium))
            label.stringValue = kind == "brightness" ? "Display brightness · from phone" : "Volume · from phone"
            bars.value = kind == "muted" ? 0 : value; bars.needsDisplay = true
            if let scr = NSScreen.main {
                let f = scr.visibleFrame
                panel.setFrameOrigin(NSPoint(x: f.maxX - 300 - 14, y: f.maxY - 66 - 10))
            }
            panel.alphaValue = 1; panel.orderFrontRegardless()
            hideWork?.cancel()
            let w = DispatchWorkItem { [self] in NSAnimationContext.runAnimationGroup({ $0.duration = 0.35; panel.animator().alphaValue = 0 }) { self.panel.orderOut(nil) } }
            hideWork = w
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6, execute: w)
        }
    }
}

func volumeStatus() -> [String: Any] {
    let v = Int(osa("output volume of (get volume settings)") ?? "") ?? -1
    let m = osa("output muted of (get volume settings)") == "true"
    return ["volume": v >= 0 ? v : NSNull(), "muted": m, "brightness": brightness() ?? NSNull(), "awake": caffeinate != nil]
}
func reportStatus() { _ = request("POST", "/v1/mac/status", body: volumeStatus()) }

/// Battery from `pmset -g batt` ("…\t87%; charging; …"). Desktops without a battery report nothing.
func reportBattery() {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/pmset"); p.arguments = ["-g", "batt"]
    let pipe = Pipe(); p.standardOutput = pipe
    guard (try? p.run()) != nil else { return }
    p.waitUntilExit()
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    guard let r = out.range(of: #"(\d+)%;\s*([a-zA-Z ]+)"#, options: .regularExpression) else { return }
    let parts = out[r].split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
    guard let pct = Int(parts[0].dropLast()) else { return }
    let state = parts.count > 1 ? parts[1] : ""
    let charging = state.hasPrefix("charging") || state.hasPrefix("charged") || out.contains("AC Power")
    _ = request("POST", "/v1/devices/battery", body: ["pct": pct, "charging": charging])
}

// ---------- clipboard: Mac → phone ----------
let pb = NSPasteboard.general
var lastCount = pb.changeCount
var lastFromPhone = ""
let skipTypes = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType", "org.nspasteboard.AutoGeneratedType",
                 "com.agilebits.onepassword", "de.petermaurer.TransientPasteboardType", "com.typeit4me.clipping"]
func checkClipboard() {
    guard pb.changeCount != lastCount else { return }
    lastCount = pb.changeCount
    guard clipSyncOn() else { return }
    let types = (pb.types ?? []).map(\.rawValue)
    if types.contains(where: { skipTypes.contains($0) }) { log("skipped a concealed/transient copy"); return }
    guard let text = pb.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !text.isEmpty, text.count <= 20_000, text != lastFromPhone else { return }
    DispatchQueue.global().async {
        if request("POST", "/v1/clip", body: ["text": text]) != nil { log("clipboard → phone (\(text.count) chars)") }
    }
}

// ---------- events: phone → Mac ----------
func handle(_ e: [String: Any]) {
    switch e["type"] as? String {
    case "clip":
        guard let text = e["text"] as? String, !text.isEmpty else { return }
        DispatchQueue.main.sync {
            lastFromPhone = text
            pb.clearContents(); pb.setString(text, forType: .string)
            lastCount = pb.changeCount
        }
        notifyMac("Copied from your phone", text)
    case "link":
        guard let s = e["url"] as? String, let url = URL(string: s), ["http", "https"].contains(url.scheme ?? "") else { return }
        DispatchQueue.main.sync { _ = NSWorkspace.shared.open(url) }
        notifyMac("Opened from your phone", (e["title"] as? String) ?? s)
    case "cmd":
        let cmd = e["cmd"] as? String ?? ""
        log("command: \(cmd)")
        switch cmd {
        case "lock": lockScreen()
        case "sleep": shell("/usr/bin/pmset", ["sleepnow"])
        case "toggle", "next", "prev": media(cmd)
        case "volume": if let v = e["value"] as? Double { osa("set volume output volume \(Int(v)) without output muted") }
        case "volup": osa("set volume output volume ((output volume of (get volume settings)) + 6) without output muted")
        case "voldown": osa("set volume output volume ((output volume of (get volume settings)) - 6)")
        case "mute": osa("set volume output muted (not (output muted of (get volume settings)))")
        case "brightness": if let v = e["value"] as? Double { setBrightness(Int(v)) }
        case "brightup": setBrightness((brightness() ?? 50) + 6)
        case "brightdown": setBrightness((brightness() ?? 50) - 6)
        case "displayoff": shell("/usr/bin/pmset", ["displaysleepnow"])
        case "awake": setAwake(caffeinate == nil); notifyMac("Koro", caffeinate != nil ? "Mac will stay awake" : "Normal sleep restored")
        case "ring": ringMac()
        case "openapp": if let a = e["app"] as? String { openApp(a) }
        case "workmode": // WhatsApp + Terminal + Gmail in Safari
            openApp("WhatsApp"); openApp("Terminal")
            shell("/usr/bin/open", ["-a", "Safari", "https://mail.google.com/"])
            notifyMac("Work mode", "WhatsApp, Terminal and Gmail are open")
        case "battery": reportBattery(); reportStatus()
        default: break
        }
        if cmd.hasPrefix("vol") || cmd == "mute" {
            let st = volumeStatus()
            HUD.shared.show((st["muted"] as? Bool) == true ? "muted" : "volume", Double((st["volume"] as? Int) ?? 0) / 100)
            _ = request("POST", "/v1/mac/status", body: st)
        } else if cmd.hasPrefix("bright") {
            HUD.shared.show("brightness", Double(brightness() ?? 0) / 100)
            reportStatus()
        } else if cmd == "awake" { reportStatus() }
    default: break
    }
}

Thread.detachNewThread {
    var since = 0.0
    reportStatus(); reportBattery()
    var lastStatus = Date(), lastBattery = Date()
    while true {
        if let r = request("GET", "/v1/mac/events?since=\(Int(since))", timeout: 40) {
            for e in (r["events"] as? [[String: Any]]) ?? [] { handle(e) }
            since = (r["seq"] as? Double) ?? since
        } else {
            Thread.sleep(forTimeInterval: 5) // offline / server restarting
        }
        if Date().timeIntervalSince(lastStatus) > 60 { reportStatus(); lastStatus = Date() }
        if Date().timeIntervalSince(lastBattery) > 300 { reportBattery(); lastBattery = Date() }
    }
}

// ---------- menu bar: remote for the phone ----------
final class Menu: NSObject, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    let header = NSMenuItem(title: "Phone", action: nil, keyEquivalent: "")
    let playing = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    let clip = NSMenuItem(title: "Clipboard sync", action: nil, keyEquivalent: "")
    let awake = NSMenuItem(title: "Keep Mac awake", action: nil, keyEquivalent: "")

    override init() {
        super.init()
        item.button?.image = NSImage(systemSymbolName: "iphone.gen3", accessibilityDescription: "Koro")
        item.button?.image?.isTemplate = true
        menu.delegate = self
        header.isEnabled = false; playing.isEnabled = false; playing.isHidden = true
        menu.addItem(header); menu.addItem(playing); menu.addItem(.separator())
        add("Play / Pause on phone", "playpause.fill") { phoneCmd("toggle") }
        add("Next track", "forward.fill") { phoneCmd("next") }
        add("Previous track", "backward.fill") { phoneCmd("prev") }
        add("Phone volume up", "speaker.wave.3.fill") { phoneCmd("volup") }
        add("Phone volume down", "speaker.wave.1.fill") { phoneCmd("voldown") }
        menu.addItem(.separator())
        add("Send clipboard to phone", "doc.on.clipboard") { sendClipboard() }
        add("Send browser tab to phone", "safari") { sendTab() }
        add("Find my phone", "bell.and.waves.left.and.right") { phoneCmd("ring") }
        add("Work mode: WhatsApp, Terminal, Gmail", "briefcase.fill") { handle(["type": "cmd", "cmd": "workmode"]) }
        menu.addItem(.separator())
        clip.target = self; clip.action = #selector(toggleClip); menu.addItem(clip)
        awake.target = self; awake.action = #selector(toggleAwake); menu.addItem(awake)
        item.menu = menu
    }
    private var actions: [() -> Void] = []
    private func add(_ title: String, _ symbol: String, _ fn: @escaping () -> Void) {
        let i = NSMenuItem(title: title, action: #selector(run(_:)), keyEquivalent: "")
        i.target = self; i.tag = actions.count; i.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        actions.append(fn); menu.addItem(i)
    }
    @objc func run(_ sender: NSMenuItem) { let fn = actions[sender.tag]; DispatchQueue.global().async { fn() } }
    @objc func toggleClip() { setClipSync(!clipSyncOn()) }
    @objc func toggleAwake() { setAwake(caffeinate == nil); DispatchQueue.global().async { reportStatus() } }

    func menuWillOpen(_ menu: NSMenu) {
        clip.state = clipSyncOn() ? .on : .off
        awake.state = caffeinate != nil ? .on : .off
        DispatchQueue.global().async { [self] in
            let r = request("GET", "/v1/phone/status", timeout: 6)
            let d = r?["device"] as? [String: Any], m = r?["media"] as? [String: Any]
            var h = (d?["name"] as? String) ?? "Phone"
            if let p = d?["battery_pct"] as? Int { h += " · \(p)%" + ((d?["charging"] as? Bool) == true ? " ⚡" : "") }
            let t = (m?["title"] as? String) ?? ""
            DispatchQueue.main.async {
                self.header.title = h
                self.playing.isHidden = t.isEmpty
                self.playing.title = t.isEmpty ? "" : "\((m?["playing"] as? Bool) == true ? "▶︎" : "❚❚")  \(t) — \((m?["artist"] as? String) ?? "")"
            }
        }
    }
}
func phoneCmd(_ cmd: String, url: String? = nil) {
    var body: [String: Any] = ["cmd": cmd]
    if let url { body["url"] = url }
    if request("POST", "/v1/phone/cmd", body: body) == nil { notifyMac("Koro", "Couldn't reach your phone") }
}
func sendClipboard() {
    let text = DispatchQueue.main.sync { pb.string(forType: .string) ?? "" }.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return notifyMac("Koro", "Clipboard is empty") }
    if request("POST", "/v1/clip", body: ["text": text]) != nil { notifyMac("Sent to phone", text) }
}
/// Front tab of whichever browser is running (asks for Automation permission the first time).
func sendTab() {
    let browsers = [("com.google.Chrome", "Google Chrome", "URL of active tab of front window"), ("company.thebrowser.Browser", "Arc", "URL of active tab of front window"),
                    ("com.brave.Browser", "Brave Browser", "URL of active tab of front window"), ("com.apple.Safari", "Safari", "URL of front document")]
    let front = DispatchQueue.main.sync { NSWorkspace.shared.frontmostApplication?.bundleIdentifier }
    let order = browsers.sorted { a, _ in a.0 == front }
    for (id, name, expr) in order where !NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty {
        if let url = osa("tell application \"\(name)\" to get \(expr)"), url.hasPrefix("http") {
            phoneCmd("link", url: url); notifyMac("Sent to phone", url); return
        }
    }
    notifyMac("Koro", "No browser tab found")
}

let menuBar = Menu()
// Play/pause for YouTube Music / YouTube in a browser goes through the keyboard media keys, which needs Accessibility.
if !AXIsProcessTrusted() {
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
}
log("Koro agent running → \(server)  clipboard sync: \(clipSyncOn() ? "on" : "off")")
Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { _ in checkClipboard() }
let mediaQueue = DispatchQueue(label: "koro.media")
Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { _ in mediaQueue.async { watchMacMedia() } }
nsapp.run()
