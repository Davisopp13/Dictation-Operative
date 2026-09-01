import Foundation
import KeyboardShortcuts

// KeyboardShortcuts isolation file. Assumed API surface (v2.x):
//   KeyboardShortcuts.Name("id", default: .init(.d, modifiers: [.command, .shift]))
//   KeyboardShortcuts.onKeyDown(for:) / onKeyUp(for:)   — handlers run on main
//   KeyboardShortcuts.Recorder("Label", name:)          — SwiftUI view (used in Settings)
// Handlers hop through Task { @MainActor } so this compiles whether or not the
// library annotates its action parameters @MainActor.
// The library is Carbon-based and can't bind bare modifiers — those are handled
// separately by ModifierHotkeyMonitor (NSEvent flagsChanged monitoring).

// The default hotkey is the ⌃⌥ Control+Option chord (ModifierHotkey.controlOption,
// see SettingsStore). The two key-combo shortcuts below ship unbound and are
// optional extras the user can record in Settings.
extension KeyboardShortcuts.Name {
    /// Press once to start, press again to stop. No default; optional.
    static let toggleDictation = Self("toggleDictation")
    /// Hold to record, release to insert. No default; optional. All bound
    /// hotkeys are always active; any can be rebound or cleared in Settings.
    static let pushToTalk = Self("pushToTalk")
}

@MainActor
final class HotkeyManager {
    /// A press-and-release shorter than this is treated as a toggle, so a
    /// quick tap of the PTT key doesn't produce an empty recording.
    private static let tapThreshold: TimeInterval = 0.3

    private weak var controller: DictationController?
    private var pttPressStart: Date?
    private let modifierMonitor: ModifierHotkeyMonitor

    init(controller: DictationController, modifierHotkey: ModifierHotkey) {
        self.controller = controller
        modifierMonitor = ModifierHotkeyMonitor(controller: controller)
        modifierMonitor.arm(modifierHotkey)

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

    func updateModifierHotkey(_ hotkey: ModifierHotkey) {
        modifierMonitor.arm(hotkey)
    }
}
