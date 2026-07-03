import AppKit
import ApplicationServices
import AVFoundation
import Foundation
import Observation

@MainActor
@Observable
final class PermissionsManager {
    private(set) var micGranted = false
    private(set) var accessibilityGranted = false

    private var pollTimer: Timer?

    var allGranted: Bool { micGranted && accessibilityGranted }

    init() {
        refresh()
    }

    func refresh() {
        micGranted = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        accessibilityGranted = AXIsProcessTrusted()
    }

    func requestMicAccess() async {
        micGranted = await AVCaptureDevice.requestAccess(for: .audio)
    }

    /// Shows the system's "grant Accessibility" prompt (once per TCC reset).
    func promptForAccessibility() {
        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [promptKey: true] as CFDictionary
        accessibilityGranted = AXIsProcessTrustedWithOptions(options)
    }

    func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func openMicrophoneSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
    }

    /// There is no notification when the user flips the Accessibility toggle,
    /// so onboarding polls while visible.
    func startPolling() {
        guard pollTimer == nil else { return }
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refresh()
            }
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}
