import Foundation

/// Rolling partial-transcript state shown in the recording indicator.
///
/// A simplified LocalAgreement: each new hypothesis is compared word-by-word
/// with the previous one, and the shared prefix counts as "confirmed". The
/// tail that still changes between passes is "pending" and rendered dimmer.
/// Pure value type — unit-tested without WhisperKit.
struct LivePreviewState: Equatable {
    private(set) var words: [String] = []
    private(set) var confirmedCount = 0

    var isEmpty: Bool { words.isEmpty }

    var confirmedText: String {
        words.prefix(confirmedCount).joined(separator: " ")
    }

    var pendingText: String {
        words.dropFirst(confirmedCount).joined(separator: " ")
    }

    /// Full current hypothesis (confirmed + pending).
    var displayText: String {
        words.joined(separator: " ")
    }

    mutating func update(with hypothesis: String) {
        let next = hypothesis
            .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
            .map(String.init)
        var agreed = 0
        while agreed < words.count, agreed < next.count, words[agreed] == next[agreed] {
            agreed += 1
        }
        // Agreement never moves backwards past what two earlier passes already
        // agreed on, unless the new hypothesis is shorter than that.
        confirmedCount = min(max(agreed, confirmedCount), next.count)
        words = next
    }

    mutating func reset() {
        words = []
        confirmedCount = 0
    }
}
