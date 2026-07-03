import AppKit
import Foundation
import os

enum InsertionResult: Equatable {
    case axInserted
    case pasted
    /// Text was left on the clipboard; the user must paste manually.
    case clipboardOnly
}

/// Facade over the two insertion strategies. The app never takes focus
/// (accessory app + non-activating panel), so the focused element at insert
/// time is normally still the app the user was dictating into.
@MainActor
struct TextInserter {
    func insert(_ text: String) async -> InsertionResult {
        if AXInserter.insert(text) {
            Log.insertion.info("Inserted via AX")
            return .axInserted
        }
        switch await PasteInserter.insert(text) {
        case .pasted:
            Log.insertion.info("Inserted via paste")
            return .pasted
        case .clipboardOnly:
            Log.insertion.info("Left on clipboard")
            return .clipboardOnly
        }
    }
}
