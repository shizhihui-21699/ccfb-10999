import Cocoa
// activate <pid> : bring a specific process's window to front, even though it
// was launched programmatically (so AppleScript app-name activation is ambiguous)
let pid = pid_t(CommandLine.arguments[1])!
if let app = NSRunningApplication(processIdentifier: pid) {
  let ok = app.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
  print("activated:", ok, app.localizedName ?? "?")
} else {
  print("no such pid")
}
