import Foundation

enum DictationState: Equatable {
    case idle
    case recording(start: Date)
    case transcribing
    case cleaning
    case inserting
    /// Dictation was asked for before setup was finished. Carries the written
    /// reason; the user chooses when to open the setup window.
    case needsSetup(String)
    case error(String)

    var symbolName: String {
        switch self {
        case .idle: return "mic"
        case .recording: return "mic.fill"
        case .transcribing, .cleaning: return "waveform"
        case .inserting: return "text.cursor"
        case .needsSetup: return "exclamationmark.circle"
        case .error: return "exclamationmark.triangle"
        }
    }

    var label: String {
        switch self {
        case .idle: return "Ready"
        case .recording: return "Listening…"
        case .transcribing: return "Transcribing…"
        case .cleaning: return "Cleaning up…"
        case .inserting: return "Inserting…"
        case .needsSetup(let message): return message
        case .error(let message): return message
        }
    }

    var isRecording: Bool {
        if case .recording = self { return true }
        return false
    }

    /// True while the pipeline is running (recording excluded).
    var isProcessing: Bool {
        switch self {
        case .transcribing, .cleaning, .inserting: return true
        default: return false
        }
    }

    /// True while the pipeline has no idea how long it will take — the states
    /// that earn an indeterminate progress indicator on the Stage.
    var isIndeterminate: Bool {
        switch self {
        case .transcribing, .cleaning: return true
        default: return false
        }
    }

    var needsSetup: Bool {
        if case .needsSetup = self { return true }
        return false
    }

    var isError: Bool {
        if case .error = self { return true }
        return false
    }
}
