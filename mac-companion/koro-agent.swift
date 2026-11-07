// Koro Mac agent: clipboard sync + remote control from the phone.
//   * Mac → phone: text you copy is sent to the phone (passwords from password managers are skipped).
//   * phone → Mac: clipboard text, links (opened in your browser), and commands: lock, sleep,
//     play/pause/next/prev, volume, mute.
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
guard let server = conf["SERVER"], let token = conf["TOKEN"] else { log("not paired: run koro-mac.sh pair first"); exit(1) }
func clipSyncOn() -> Bool { readConf()["CLIP_SYNC"] != "0" }

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
    if let send = mediaRemote, send(code, nil) { return }
    let verb = cmd == "toggle" ? "playpause" : cmd == "next" ? "next track" : "previous track"
    for app in ["Spotify", "Music"] where NSRunningApplication.runningApplications(withBundleIdentifier: app == "Spotify" ? "com.spotify.client" : "com.apple.Music").count > 0 {
        osa("tell application \"\(app)\" to \(verb)"); return
    }
}

typealias LockFn = @convention(c) () -> Void
func lockScreen() {
    if let h = dlopen("/System/Library/PrivateFrameworks/login.framework/Versions/Current/login", RTLD_NOW),
       let sym = dlsym(h, "SACLockScreenImmediate") {
        unsafeBitCast(sym, to: LockFn.self)(); return
    }
    shell("/usr/bin/pmset", ["displaysleepnow"]) // locks when "require password immediately" is on
}

func volumeStatus() -> [String: Any] {
    let v = Int(osa("output volume of (get volume settings)") ?? "") ?? -1
    let m = osa("output muted of (get volume settings)") == "true"
    return ["volume": v >= 0 ? v : NSNull(), "muted": m]
}
func reportStatus() { _ = request("POST", "/v1/mac/status", body: volumeStatus()) }

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
        case "volup": osa("set volume output volume ((output volume of (get volume settings)) + 10) without output muted")
        case "voldown": osa("set volume output volume ((output volume of (get volume settings)) - 10)")
        case "mute": osa("set volume output muted (not (output muted of (get volume settings)))")
        default: break
        }
        if cmd.hasPrefix("vol") || cmd == "mute" { reportStatus() }
    default: break
    }
}

Thread.detachNewThread {
    var since = 0.0
    reportStatus()
    var lastStatus = Date()
    while true {
        if let r = request("GET", "/v1/mac/events?since=\(Int(since))", timeout: 40) {
            for e in (r["events"] as? [[String: Any]]) ?? [] { handle(e) }
            since = (r["seq"] as? Double) ?? since
        } else {
            Thread.sleep(forTimeInterval: 5) // offline / server restarting
        }
        if Date().timeIntervalSince(lastStatus) > 60 { reportStatus(); lastStatus = Date() }
    }
}

log("Koro agent running → \(server)  clipboard sync: \(clipSyncOn() ? "on" : "off")")
Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { _ in checkClipboard() }
RunLoop.main.run()
