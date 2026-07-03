import Foundation

enum DictationState: Equatable {
    case idle
    case recording(start: Date)
    case transcribing
    case cleaning
    case inserting
    case error(String)

    var symbolName: String {
        switch self {
        case .idle: return "mic"
        case .recording: return "mic.fill"
        case .transcribing, .cleaning: return "waveform"
        case .inserting: return "text.cursor"
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
}
