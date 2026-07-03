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

    private(set) var hotkeys: HotkeyManager?
    private var onboardingWindow: OnboardingWindowController?

    private init() {
        settings = SettingsStore()
        permissions = PermissionsManager()
        history = HistoryStore()
        modelManager = ModelManager()
        transcription = TranscriptionService()
        controller = DictationController(
            settings: settings,
            permissions: permissions,
            modelManager: modelManager,
            transcription: transcription,
            history: history
        )
        controller.onSetupNeeded = { [weak self] in
            self?.showOnboarding()
        }
    }

    /// Called once from applicationDidFinishLaunching.
    func start() {
        hotkeys = HotkeyManager(controller: controller)
        permissions.refresh()
        preloadModelIfAvailable()
        if !settings.onboardingCompleted {
            showOnboarding()
        }
    }

    func showOnboarding() {
        if onboardingWindow == nil {
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
