import XCTest
@testable import Dictation

final class HistoryStoreTests: XCTestCase {
    private var tempFile: URL!

    override func setUp() {
        super.setUp()
        tempFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("history-test-\(UUID().uuidString).json")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempFile)
        super.tearDown()
    }

    private func makeEntry(text: String = "hello world") -> HistoryEntry {
        HistoryEntry(
            id: UUID(),
            date: Date(),
            rawText: text,
            cleanedText: nil,
            appBundleID: "com.apple.TextEdit",
            durationSec: 1.5
        )
    }

    func testAddPersistsAcrossReload() {
        let store = HistoryStore(fileURL: tempFile)
        let entry = makeEntry()
        store.add(entry)

        let reloaded = HistoryStore(fileURL: tempFile)
        XCTAssertEqual(reloaded.entries.count, 1)
        XCTAssertEqual(reloaded.entries.first?.id, entry.id)
        XCTAssertEqual(reloaded.entries.first?.rawText, "hello world")
    }

    func testNewestFirstOrdering() {
        let store = HistoryStore(fileURL: tempFile)
        store.add(makeEntry(text: "first"))
        store.add(makeEntry(text: "second"))
        XCTAssertEqual(store.entries.first?.rawText, "second")
    }

    func testCapAtMaxEntries() {
        let store = HistoryStore(fileURL: tempFile)
        for i in 0..<(HistoryStore.maxEntries + 25) {
            store.add(makeEntry(text: "entry \(i)"))
        }
        XCTAssertEqual(store.entries.count, HistoryStore.maxEntries)
        // The newest entry survives; the oldest were trimmed.
        XCTAssertEqual(store.entries.first?.rawText, "entry \(HistoryStore.maxEntries + 24)")
    }

    func testDisplayTextPrefersCleaned() {
        let entry = HistoryEntry(
            id: UUID(),
            date: Date(),
            rawText: "um hello",
            cleanedText: "Hello.",
            appBundleID: nil,
            durationSec: 1
        )
        XCTAssertEqual(entry.displayText, "Hello.")
    }

    func testClearEmptiesStoreAndDisk() {
        let store = HistoryStore(fileURL: tempFile)
        store.add(makeEntry())
        store.clear()
        XCTAssertTrue(store.entries.isEmpty)
        XCTAssertTrue(HistoryStore(fileURL: tempFile).entries.isEmpty)
    }
}
