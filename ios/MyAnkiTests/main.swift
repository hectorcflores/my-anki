import Foundation
import CryptoKit

struct Case: Decodable {
    let cardID: String
    let prev: ReviewState?
    let grade: Int
    let now: Double
    let expected: ReviewState
}
let path = CommandLine.arguments[1]
let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
for (i, test) in cases.enumerated() {
    let result = Scheduler.schedule(test.prev, grade: test.grade, now: test.now, cardID: test.cardID)
    guard result == test.expected else {
        print("Mismatch \(i): \(result) vs \(test.expected)")
        exit(1)
    }
}
print("PASS: \(cases.count) Swift results match the web scheduler")

func check(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { print("FAIL: \(message)"); exit(1) }
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent("myanki-tests-\(UUID().uuidString)")
defer { try? FileManager.default.removeItem(at: root) }
let disk = StudyDisk(url: root.appendingPathComponent("account.json"), accountID: "test-account")
let cards = (0..<12).map { i in StudyCard(id: String(format: "%016x", i), book: "Book", question: "Question", answer: "Answer", date: String(format: "2026-09-%02d", i+1), highlightedAt: nil) }
let clock: Double = 1780000000000
var engine = try StudyEngine(cards: cards, disk: disk)
check(engine.queue(now: clock).map(\.id) == Array(cards.reversed().prefix(5)).map(\.id), "freshest highlights first")
let cardID = cards.last!.id
try engine.answer(cardID, grade: 0, now: clock)
let reloaded = try StudyEngine(cards: cards, disk: disk)
check(reloaded.snapshot == engine.snapshot, "close/reopen restores state and stable pending event ID")
check(!reloaded.queue(now: clock + 1).contains(where: { $0.id == cardID }), "Again is not offered early")
check(reloaded.queue(now: clock + 60000).contains(where: { $0.id == cardID }), "Again returns when due among reserved fresh slots")
let prior = engine.snapshot.states[cardID]
let answers = engine.answersToday(clock)
try engine.setHidden(cardID, hidden: true, now: clock + 1)
check(!engine.queue(now: clock + 60000).contains(where: { $0.id == cardID }), "hidden cards stay excluded")
check(engine.snapshot.states[cardID] == prior && engine.answersToday(clock) == answers, "hide does not alter scheduling or answer count")
try engine.setHidden(cardID, hidden: false, now: clock + 1)
check(engine.snapshot.visibilityEvents.count == 2 && engine.snapshot.visibility[cardID]?.at == clock + 2, "undo appends a newer immutable event")
check(engine.answersToday(clock + 86400000) == 0, "answer counter resets next day")
let other = StudyDisk(url: root.appendingPathComponent("other.json"), accountID: "other-account")
let otherEngine = try StudyEngine(cards: cards, disk: other)
check(otherEngine.snapshot.reviews.isEmpty, "account files remain isolated")
do {
    _ = try StudyDisk(url: disk.url, accountID: "wrong-account").load()
    check(false, "account mismatch rejected")
} catch StudyError.wrongAccount { }
let beforeFailure = engine.snapshot
try FileManager.default.removeItem(at: root)
try Data("not a directory".utf8).write(to: root)
do {
    try engine.answer(cards[0].id, grade: 2, now: clock)
    check(false, "failed disk write must throw")
} catch { check(engine.snapshot == beforeFailure, "failed save leaves state and event queue unchanged") }
print("PASS: persistence, due waits, hide/undo, account isolation, daily reset and failed-write recovery")

try FileManager.default.removeItem(at: root)
var synced = try StudyEngine(cards: cards, disk: disk)
try synced.answer(cards[0].id, grade: 2, now: clock)
let event = synced.snapshot.reviews[0]
let oneBook = StudyCatalog(books: [.init(title: "Book", highlights: cards.map { .init(id: $0.id, text: $0.answer, q: $0.question, date: $0.date, highlightedAt: nil, aligned: nil) })])
try synced.applyCloud(baseline: [:], reviews: [event], visibility: [], catalog: oneBook, now: clock + 100)
check(synced.snapshot.reviews.isEmpty, "confirmed event leaves outbox")
let confirmedState = synced.snapshot.states[cards[0].id]
try synced.applyCloud(baseline: [:], reviews: [event], visibility: [], catalog: oneBook, now: clock + 200)
check(synced.snapshot.states[cards[0].id] == confirmedState, "repeated cloud pull does not apply event twice")
try synced.answer(cards[1].id, grade: 3, now: clock + 1000)
let newerPending = synced.snapshot.reviews[0]
try synced.applyCloud(baseline: [:], reviews: [event], visibility: [], catalog: oneBook, now: clock + 2000)
check(synced.snapshot.reviews == [newerPending] && synced.snapshot.states[cards[1].id] != nil, "answer created during sync survives remote merge")
let cloudHidden = LocalVisibility(id: "a", cardId: cards[2].id, hidden: true, at: clock)
let cloudRestore = LocalVisibility(id: "z", cardId: cards[2].id, hidden: false, at: clock)
try synced.applyCloud(baseline: [:], reviews: [event], visibility: [cloudRestore, cloudHidden], catalog: oneBook, now: clock + 2000)
check(synced.snapshot.visibility[cards[2].id]?.hidden == false, "visibility ID breaks equal-time ties independently of delivery order")
let staticHighlight = StudyCatalog.Book.Highlight(id: "1234567890abcdef", text: "A sufficiently long highlight for matching", q: "Original question", date: nil, highlightedAt: nil, aligned: nil)
let published = StudyCatalog(books: [.init(title: "BOOK", highlights: [staticHighlight])])
let importRow: [String: Any] = ["books": [["title": "Book", "asin": "ASIN", "highlights": [["text": staticHighlight.text, "location": 1, "highlightedAt": "2026-09-25T10:00:00Z"]]]]]
let imported = try published.merging([CloudDocument(id: "import", fields: importRow)])
check(imported.cards.count == 1 && imported.cards[0].id == staticHighlight.id && imported.cards[0].question == "Original question" && imported.cards[0].date == "2026-09-25", "import preserves existing identity/question and enriches date")
let decoded = try CloudAPI.decodeFields(["grade": ["integerValue": "3"], "hidden": ["booleanValue": true], "text": ["stringValue": "hello"], "nested": ["arrayValue": ["values": [["nullValue": NSNull()]]]]])
check((decoded["grade"] as? Double) == 3 && decoded["hidden"] as? Bool == true, "Firestore REST values decode without altering types")
print("PASS: cloud replay idempotency, answers during sync, visibility tie-break and imported catalog identity")
let numericImport = CloudDocument(id: "numeric", fields: ["books": [["title": "Different Book", "asin": "ASIN", "highlights": [["text": "New highlight", "location": NSNumber(value: 1.0)]]]]])
let numericCatalog = try StudyCatalog(books: []).merging([numericImport])
let expectedID = SHA256.hash(data: Data("ASIN|Different Book|1|New highlight".utf8)).map { String(format: "%02x", $0) }.joined().prefix(16)
check(numericCatalog.cards[0].id == expectedID, "Firestore numeric locations produce the exact web identity")
check(StudyCatalog.normalized("ＦＯＯ  ‘bar’") == "foo 'bar'", "Unicode normalization matches the web")
print("PASS: Unicode matching and cross-platform import IDs")
