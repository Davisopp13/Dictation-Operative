import Foundation
import Observation
import Sparkle

// Sparkle isolation file. Assumed API surface (2.x):
//   SPUStandardUpdaterController(startingUpdater:updaterDelegate:userDriverDelegate:)
//   controller.updater.canCheckForUpdates   — KVO-compliant Bool
//   controller.checkForUpdates(_ sender: Any?)
// If the signature drifted, fixes belong in this file only.

/// Wraps Sparkle. The updater only starts when the build carries a public
/// EdDSA key (injected by the release workflow); dev and CI builds have none,
/// so they never phone home and the menu item is hidden.
@MainActor
@Observable
final class UpdaterService {
    /// False for ad-hoc/dev builds without a Sparkle public key.
    let isConfigured: Bool
    /// Mirrors Sparkle's `canCheckForUpdates` (false while a check is running).
    private(set) var canCheckForUpdates = false

    private var controller: SPUStandardUpdaterController?
    private var observation: NSKeyValueObservation?

    init() {
        let bundle = Bundle.main
        let publicKey = (bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String) ?? ""
        let feedURL = (bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String) ?? ""
        isConfigured = !publicKey.isEmpty && !feedURL.isEmpty
        guard isConfigured else {
            Log.app.info("Sparkle disabled: no SUPublicEDKey in this build")
            return
        }

        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        self.controller = controller
        observation = controller.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] updater, _ in
            let value = updater.canCheckForUpdates
            Task { @MainActor in
                self?.canCheckForUpdates = value
            }
        }
    }

    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }
}
