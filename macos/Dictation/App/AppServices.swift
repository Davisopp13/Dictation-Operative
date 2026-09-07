import Foundation
import os

/// Composition root. A singleton so the SwiftUI App, the NSApplicationDelegate,
/// and hotkey callbacks all share one object graph.
@MainActor
final class AppServices {
    static let shared = AppServices()

    let settings: SettingsStore
    let permissions: PermissionsManager
    let history: HistoryStore
    let modelManager: ModelManager
    let transcription: TranscriptionService
    let controller: DictationController
    let sync: SyncService
    let updater: UpdaterService

    private(set) var hotkeys: HotkeyManager?
    private var onboardingWindow: OnboardingWindowController?

    private init() {
        sync = SyncService()
        settings = SettingsStore()
        permissions = PermissionsManager()
        history = HistoryStore()
        modelManager = ModelManager()
        transcription = TranscriptionService()
        // Sparkle defers its first check until after the app finishes launching.
        updater = UpdaterService()
        controller = DictationController(
            settings: settings,
            permissions: permissions,
            modelManager: modelManager,
            transcription: transcription,
            history: history
        )
        controller.onCompletedDictation = { [weak self] text in self?.sync.completedDictation(text) }
        controller.onSetupNeeded = { [weak self] in
            self?.showOnboarding()
        }
    }

    /// Called once from applicationDidFinishLaunching.
    func start() {
        hotkeys = HotkeyManager(controller: controller, modifierHotkey: settings.modifierHotkey)
        sync.start()
        permissions.refresh()
        preloadModelIfAvailable()
        if !settings.onboardingCompleted || !permissions.allGranted {
            showOnboarding()
        }
    }

    func showOnboarding() {
        permissions.refresh()
        if onboardingWindow?.window?.isVisible != true {
            onboardingWindow = OnboardingWindowController(services: self)
        }
        onboardingWindow?.show()
    }

    /// Loads the selected model in the background so the first dictation is fast.
    func preloadModelIfAvailable() {
        let variant = settings.selectedModelVariant
        guard let folder = modelManager.folder(for: variant) else { return }
        Task {
            do {
                try await transcription.loadModel(variant: variant, folder: folder)
            } catch {
                Log.transcription.error("Model preload failed: \(error.localizedDescription)")
            }
        }
    }

    /// Switches the active model (called from Settings/onboarding after download).
    func activateModel(variant: String) {
        settings.selectedModelVariant = variant
        preloadModelIfAvailable()
    }
}
