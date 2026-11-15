import Cocoa
import Foundation

// Human-like input via the real OS event pipeline (CGEvent), so the browser
// produces trusted events through its actual input stack rather than CDP.
// Usage: human_input <json-file>
// JSON: { "moves": [[x,y,dtMs],...], "clicks": [[x,y,dwellMs],...],
//         "keys": [[keycode, downMs, gapMs, flags],...] }

struct Plan: Decodable {
    struct Click: Decodable { let x: Double; let y: Double; let dwell: Double }
    struct Key: Decodable { let code: CGKeyCode; let down: Double; let gap: Double }
    let moves: [[Double]]
    let clicks: [Click]
    let keys: [Key]
}

let args = CommandLine.arguments
guard args.count > 1, let data = FileManager.default.contents(atPath: args[1]) else {
    FileHandle.standardError.write("need json path\n".data(using: .utf8)!)
    exit(2)
}
let plan = try! JSONDecoder().decode(Plan.self, from: data)
let src = CGEventSource(stateID: .hidSystemState)
// CGEvent global cursor coordinates are already top-left origin (unlike
// NSEvent.mouseLocation), so plan coordinates pass through unchanged.
func toPos(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x, y: y) }

func wait(_ ms: Double) {
    if ms > 0 { usleep(useconds_t(ms * 1000)) }
}

for m in plan.moves {
    let p = toPos(m[0], m[1])
    let e = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)
    e?.setIntegerValueField(.mouseEventDeltaX, value: Int64(0))
    e?.post(tap: .cghidEventTap)
    wait(m.count > 2 ? m[2] : 16)
}
for c in plan.clicks {
    let p = toPos(c.x, c.y)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    wait(30)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    wait(c.dwell)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
    wait(60)
}
for k in plan.keys {
    let d = CGEvent(keyboardEventSource: src, virtualKey: k.code, keyDown: true)
    d?.post(tap: .cghidEventTap)
    wait(k.down)
    let u = CGEvent(keyboardEventSource: src, virtualKey: k.code, keyDown: false)
    u?.post(tap: .cghidEventTap)
    wait(k.gap)
}
