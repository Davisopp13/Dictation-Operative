import AppKit
import Foundation

/// A dictation trigger on a bare modifier key/chord — something the Carbon-based
/// KeyboardShortcuts library cannot bind. One binding drives both modes:
/// quick tap = toggle recording, press-and-hold = record while held, release = insert.
enum ModifierHotkey: String, CaseIterable, Identifiable {
    case off
    case controlOption
    case rightCommand
    case rightOption
    case fn

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .off: return "Off"
        case .controlOption: return "⌃⌥ Control + Option"
        case .rightCommand: return "Right ⌘ Command"
        case .rightOption: return "Right ⌥ Option"
        case .fn: return "🌐 Fn / Globe"
        }
    }

    // Virtual key codes reported in flagsChanged events.
    private static let kVK_RightCommand: UInt16 = 54
    private static let kVK_RightOption: UInt16 = 61
    private static let kVK_Function: UInt16 = 63

    /// Whether the chord is currently engaged, given a flagsChanged event's data.
    func isEngaged(keyCode: UInt16, flags: NSEvent.ModifierFlags) -> Bool {
        let clean = flags.intersection(.deviceIndependentFlagsMask)
        switch self {
        case .off:
            return false
        case .controlOption:
            // Exact match so ⌃⌥ inside a bigger chord (e.g. ⌃⌥⌘) doesn't trigger.
            return clean == [.control, .option]
        case .rightCommand:
            return keyCode == Self.kVK_RightCommand && clean == .command
        case .rightOption:
            return keyCode == Self.kVK_RightOption && clean == .option
        case .fn:
            return keyCode == Self.kVK_Function && clean == .function
        }
    }
}

/// Watches flagsChanged/keyDown globally (and locally, for when our own windows
/// have focus) and drives the controller with tap-vs-hold semantics. Requires
/// Accessibility trust, which the app already needs for insertion.
@MainActor
final class ModifierHotkeyMonitor {
    /// Same tap threshold as HotkeyManager's push-to-talk debounce.
    private static let tapThreshold: TimeInterval = 0.3

    private weak var controller: DictationController?
    private var hotkey: ModifierHotkey = .off
    private var globalMonitor: Any?
    private var localMonitor: Any?

    private var chordActive = false
    private var pressStart: Date?
    /// Set when the chord turned out to be part of a normal shortcut
    /// (another key was pressed while it was held) — the release is ignored.
    private var consumed = false
    private var startedRecordingThisPress = false

    init(controller: DictationController) {
        self.controller = controller
    }

    func arm(_ hotkey: ModifierHotkey) {
        disarm()
        self.hotkey = hotkey
        guard hotkey != .off else { return }

        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { [weak self] event in
            let type = event.type
            let keyCode = event.keyCode
            let flags = event.modifierFlags
            Task { @MainActor in
                self?.handle(type: type, keyCode: keyCode, flags: flags)
            }
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { [weak self] event in
            let type = event.type
            let keyCode = event.keyCode
            let flags = event.modifierFlags
            Task { @MainActor in
                self?.handle(type: type, keyCode: keyCode, flags: flags)
            }
            return event
        }
    }

    func disarm() {
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        globalMonitor = nil
        localMonitor = nil
        chordActive = false
        pressStart = nil
        consumed = false
        startedRecordingThisPress = false
    }

    private func handle(type: NSEvent.EventType, keyCode: UInt16, flags: NSEvent.ModifierFlags) {
        switch type {
        case .keyDown:
            // The modifier is being used as part of a regular shortcut
            // (e.g. ⌃⌥←) — abort and ignore the eventual release.
            guard chordActive, !consumed else { return }
            consumed = true
            if startedRecordingThisPress, controller?.state.isRecording == true {
                controller?.cancel()
            }

        case .flagsChanged:
            let engaged = hotkey.isEngaged(keyCode: keyCode, flags: flags)
            if engaged, !chordActive {
                chordDown()
            } else if !engaged, chordActive {
                chordUp()
            }

        default:
            break
        }
    }

    private func chordDown() {
        chordActive = true
        consumed = false
        startedRecordingThisPress = false
        pressStart = Date()
        guard let controller else { return }
        if controller.state.isRecording {
            // Recording from an earlier tap — this press stops it.
            controller.stopAndProcess()
            consumed = true
        } else {
            startedRecordingThisPress = true
            controller.startRecording()
        }
    }

    private func chordUp() {
        chordActive = false
        defer {
            pressStart = nil
            consumed = false
            startedRecordingThisPress = false
        }
        guard !consumed, let controller, let start = pressStart else { return }
        if Date().timeIntervalSince(start) >= Self.tapThreshold, controller.state.isRecording {
            controller.stopAndProcess()
        }
        // else: quick tap — stay recording, acting as a toggle.
    }
}
