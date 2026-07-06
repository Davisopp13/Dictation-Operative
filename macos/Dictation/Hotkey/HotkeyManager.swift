import Foundation
import KeyboardShortcuts

// KeyboardShortcuts isolation file. Assumed API surface (v2.x):
//   KeyboardShortcuts.Name("id", default: .init(.d, modifiers: [.command, .shift]))
//   KeyboardShortcuts.onKeyDown(for:) / onKeyUp(for:)   — handlers run on main
//   KeyboardShortcuts.Recorder("Label", name:)          — SwiftUI view (used in Settings)
// Handlers hop through Task { @MainActor } so this compiles whether or not the
// library annotates its action parameters @MainActor.
// Known limitation: Carbon-based, so no modifier-only/Fn hotkeys (roadmap: Phase 2 event tap).

extension KeyboardShortcuts.Name {
    /// Press once to start, press again to stop (default ⌘⇧D).
    static let toggleDictation = Self("toggleDictation", default: .init(.d, modifiers: [.command, .shift]))
    /// Hold to record, release to insert (default ⌥Space). Both hotkeys are
    /// always active; either can be rebound or cleared in Settings.
    static let pushToTalk = Self("pushToTalk", default: .init(.space, modifiers: [.option]))
}

@MainActor
final class HotkeyManager {
    /// A press-and-release shorter than this is treated as a toggle, so a
    /// quick tap of the PTT key doesn't produce an empty recording.
    private static let tapThreshold: TimeInterval = 0.3

    private weak var controller: DictationController?
    private var pttPressStart: Date?

    init(controller: DictationController) {
        self.controller = controller

        KeyboardShortcuts.onKeyDown(for: .toggleDictation) { [weak self] in
            Task { @MainActor in
                self?.controller?.toggle()
            }
        }

        KeyboardShortcuts.onKeyDown(for: .pushToTalk) { [weak self] in
            Task { @MainActor in
                guard let self, let controller = self.controller else { return }
                if controller.state.isRecording {
                    // A previous tap left us recording in toggle mode; stop now.
                    self.pttPressStart = nil
                    controller.stopAndProcess()
                } else {
                    self.pttPressStart = Date()
                    controller.startRecording()
                }
            }
        }

        KeyboardShortcuts.onKeyUp(for: .pushToTalk) { [weak self] in
            Task { @MainActor in
                guard let self, let controller = self.controller,
                      let start = self.pttPressStart else { return }
                self.pttPressStart = nil
                if Date().timeIntervalSince(start) >= Self.tapThreshold, controller.state.isRecording {
                    controller.stopAndProcess()
                }
                // else: quick tap — stay recording, acting as a toggle.
            }
        }
    }
}
