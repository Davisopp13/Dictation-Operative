import Foundation
import Observation
import os
import WhisperKit

// WhisperKit isolation file 1 of 2 (the other is TranscriptionService.swift).
// Assumed API surface, pinned to 0.9.x:
//   static WhisperKit.download(variant: String, downloadBase: URL?, useBackgroundSession: Bool,
//                              from: String = "argmaxinc/whisperkit-coreml", token: String? = nil,
//                              progressCallback: ((Progress) -> Void)?) async throws -> URL
// If the signature drifted, fixes belong in this file only.

/// Downloads and tracks WhisperKit models on disk. The variant → folder map is
/// persisted so we never have to guess WhisperKit's directory layout.
@MainActor
@Observable
final class ModelManager {
    private static let foldersKey = "downloadedModelFolders"

    /// variant → absolute folder path, persisted in UserDefaults.
    private(set) var downloadedFolders: [String: String]
    /// variant → 0...1 while a download is in flight.
    private(set) var downloadProgress: [String: Double] = [:]
    private(set) var lastDownloadError: String?

    let baseFolder: URL
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        baseFolder = support.appendingPathComponent("Dictation/Models", isDirectory: true)
        try? FileManager.default.createDirectory(at: baseFolder, withIntermediateDirectories: true)

        let stored = defaults.dictionary(forKey: Self.foldersKey) as? [String: String] ?? [:]
        // Drop entries whose folders were deleted out from under us.
        downloadedFolders = stored.filter { FileManager.default.fileExists(atPath: $0.value) }
        if downloadedFolders.count != stored.count {
            defaults.set(downloadedFolders, forKey: Self.foldersKey)
        }
    }

    func isDownloaded(_ variant: String) -> Bool {
        downloadedFolders[variant] != nil
    }

    func folder(for variant: String) -> String? {
        downloadedFolders[variant]
    }

    var hasAnyModel: Bool { !downloadedFolders.isEmpty }

    func download(_ variant: String) async {
        guard downloadProgress[variant] == nil else { return }
        downloadProgress[variant] = 0
        lastDownloadError = nil
        do {
            let folder = try await WhisperKit.download(
                variant: variant,
                downloadBase: baseFolder,
                useBackgroundSession: false,
                progressCallback: { progress in
                    let fraction = progress.fractionCompleted
                    Task { @MainActor [weak self] in
                        self?.downloadProgress[variant] = fraction
                    }
                }
            )
            downloadedFolders[variant] = folder.path
            defaults.set(downloadedFolders, forKey: Self.foldersKey)
            Log.transcription.info("Downloaded model \(variant, privacy: .public)")
        } catch {
            lastDownloadError = "Download failed: \(error.localizedDescription)"
            Log.transcription.error("Model download failed: \(error.localizedDescription)")
        }
        downloadProgress[variant] = nil
    }

    func delete(_ variant: String) {
        if let path = downloadedFolders[variant] {
            try? FileManager.default.removeItem(atPath: path)
        }
        downloadedFolders[variant] = nil
        defaults.set(downloadedFolders, forKey: Self.foldersKey)
    }
}
