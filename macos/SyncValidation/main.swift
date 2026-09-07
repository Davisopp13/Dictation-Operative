import AppKit
import Foundation
import ImageIO

// Test harness uses the real native adapter on an isolated pasteboard; no user clipboard content is read.
struct Input: Decodable {
  var pair: SyncPairRecord
  var operation: String
  var mime: String?
  var bytes: String?
}
@main struct Validate {
  @MainActor static func main() async {
    do {
      let input = try JSONDecoder().decode(
        Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
      let client = SyncTransport(pair: input.pair)
      if input.operation == "capture-system" || input.operation == "restore-system" {
        let backup = NSPasteboard(name: .init("org.dictation.sync.validation.backup"))
        let source = input.operation == "capture-system" ? NSPasteboard.general : backup
        let target = input.operation == "capture-system" ? backup : NSPasteboard.general
        let items = (source.pasteboardItems ?? []).map { original in
          let item = NSPasteboardItem()
          for type in original.types {
            if let data = original.data(forType: type) { item.setData(data, forType: type) }
          }
          return item
        }
        target.clearContents()
        if !items.isEmpty { target.writeObjects(items) }
        if input.operation == "restore-system" { backup.clearContents() }
        print("{\"clipboardSnapshotHandled\":true}")
        return
      }
      let clipboard = MacClipboardAdapter(
        board: NSPasteboard(name: .init("DO-Sync-Validation-" + UUID().uuidString)))
      if input.operation == "join" {
        try await client.join()
        print("{\"joined\":true}")
        return
      }
      if input.operation == "derive" {
        let result = [
          "room": try input.pair.room, "token": try input.pair.token,
          "key": try input.pair.derive("content-key").base64EncodedString(),
        ]
        print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
        return
      }
      if input.operation == "send" {
        let payload = SyncPayload(mime: input.mime!, bytes: Data(base64Encoded: input.bytes!)!)
        try clipboard.write(payload, expectedCount: clipboard.changeCount)
        let read = try clipboard.read()
        guard read.bytes == payload.bytes else {
          throw SyncFailure("Native clipboard read mismatch")
        }
        _ = try await client.send(read)
        print("{\"sent\":true}")
        return
      }
      guard let latest = try await client.state().latest else {
        throw SyncFailure("No pending test transfer")
      }
      let payload = try await client.receive(latest)
      if input.operation == "receive-system" {
        let system = MacClipboardAdapter()
        try system.write(payload, expectedCount: system.changeCount)
        try await client.ack(latest.id)
        print("{\"systemClipboardWritten\":true}")
        return
      }
      try clipboard.write(payload, expectedCount: clipboard.changeCount)
      let read = try clipboard.read()
      guard read.bytes == payload.bytes, clipboard.isAutomaticExcluded else {
        throw SyncFailure("Native clipboard roundtrip or loop marker failed")
      }
      // A concurrent local copy must defeat a delayed receive.
      let oldCount = clipboard.changeCount
      clipboard.board.clearContents()
      clipboard.board.setString("New local copy", forType: .string)
      do {
        try clipboard.write(payload, expectedCount: oldCount)
        throw SyncFailure("Stale overwrite was not blocked")
      } catch let error as SyncFailure where error.message.contains("clipboard changed") {}
      var result: [String: Any] = [
        "mime": read.mime, "digest": read.bytes.syncSHA, "loopExcluded": true,
        "staleOverwriteBlocked": true,
      ]
      if read.mime == "image/png" {
        let source = CGImageSourceCreateWithData(read.bytes as CFData, nil)!
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
        result["width"] = image.width
        result["height"] = image.height
        result["alpha"] =
          image.alphaInfo != .none && image.alphaInfo != .noneSkipFirst
          && image.alphaInfo != .noneSkipLast
      }
      try await client.ack(latest.id)
      print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
    } catch {
      fputs("Native Sync validation failed: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}
