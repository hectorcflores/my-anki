import Foundation

struct StudyCatalog: Codable, Equatable {
    struct Book: Codable, Equatable {
        struct Highlight: Codable, Equatable {
            let id: String
            let text: String
            let q: String?
            let date: String?
            let highlightedAt: String?
            let aligned: Bool?
        }
        let title: String
        let highlights: [Highlight]
    }
    let books: [Book]
    var cards: [StudyCard] {
        books.flatMap { book in
            book.highlights.filter { $0.aligned != false }.map {
                StudyCard(id: $0.id, book: book.title, question: $0.q ?? "What is the key idea in this highlight?", answer: $0.text, date: $0.date, highlightedAt: $0.highlightedAt)
            }
        }
    }
}

struct StudyCard: Equatable, Identifiable {
    let id: String
    let book: String
    let question: String
    let answer: String
    let date: String?
    let highlightedAt: String?
    var highlightTime: Double {
        guard let raw = highlightedAt ?? date else { return -.infinity }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: raw) { return d.timeIntervalSince1970 * 1000 }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: raw) { return d.timeIntervalSince1970 * 1000 }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        // Date-only follows JS Date.parse (UTC); timestamp without zone follows local time.
        parser.timeZone = raw.count == 10 ? TimeZone(secondsFromGMT: 0) : .current
        parser.dateFormat = raw.count == 10 ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm:ss"
        return parser.date(from: raw).map { $0.timeIntervalSince1970 * 1000 } ?? -.infinity
    }
}

struct LocalReview: Codable, Equatable, Identifiable {
    let id: String
    let cardId: String
    let grade: Int
    let reviewedAt: Double
    let clientId: String
}
struct LocalVisibility: Codable, Equatable, Identifiable {
    let id: String
    let cardId: String
    let hidden: Bool
    let at: Double
}
struct StudySnapshot: Codable, Equatable {
    var schemaVersion = 1
    var accountID: String
    var clientID = UUID().uuidString
    var states: [String: ReviewState] = [:]
    var reviews: [LocalReview] = []
    var visibility: [String: LocalVisibility] = [:]
    var visibilityEvents: [LocalVisibility] = []
    var answerDay = ""
    var answerCount = 0
    var cachedCatalog: StudyCatalog?
    var lastSyncAt: Double?
    var lastKindleDeliveryAt: Double?
}

/// One atomic file per account. A failed save never mutates the active snapshot.
final class StudyDisk {
    let url: URL
    let accountID: String
    init(url: URL, accountID: String) { self.url = url; self.accountID = accountID }
    func load() throws -> StudySnapshot {
        guard FileManager.default.fileExists(atPath: url.path) else { return StudySnapshot(accountID: accountID) }
        let snapshot = try JSONDecoder().decode(StudySnapshot.self, from: Data(contentsOf: url))
        guard snapshot.schemaVersion == 1, snapshot.accountID == accountID else { throw StudyError.wrongAccount }
        return snapshot
    }
    func save(_ snapshot: StudySnapshot) throws {
        guard snapshot.accountID == accountID else { throw StudyError.wrongAccount }
        let data = try JSONEncoder().encode(snapshot)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
}
enum StudyError: Error { case wrongAccount, unknownCard, hiddenCard, notDue }

struct StudyEngine {
    private(set) var cards: [StudyCard]
    private(set) var snapshot: StudySnapshot
    let disk: StudyDisk
    init(cards: [StudyCard], disk: StudyDisk) throws {
        self.cards = cards; self.disk = disk; self.snapshot = try disk.load()
        if let cached = snapshot.cachedCatalog { self.cards = cached.cards }
    }
    static func day(_ now: Double) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date(timeIntervalSince1970: now / 1000))
    }
    func answersToday(_ now: Double) -> Int { snapshot.answerDay == Self.day(now) ? snapshot.answerCount : 0 }
    func queue(now: Double) -> [StudyCard] {
        let eligible = cards.filter { snapshot.states[$0.id]?.leech != true && snapshot.visibility[$0.id]?.hidden != true }
        let due = eligible.filter { snapshot.states[$0.id].map { $0.due <= now } ?? false }.sorted {
            let a = snapshot.states[$0.id]!.due, b = snapshot.states[$1.id]!.due
            return a == b ? $0.id < $1.id : a < b
        }
        let fresh = eligible.filter { snapshot.states[$0.id] == nil }.sorted {
            $0.highlightTime == $1.highlightTime ? $0.id < $1.id : $0.highlightTime > $1.highlightTime
        }
        let reserved = Array(fresh.prefix(2))
        let selected = Array(due.prefix(5 - reserved.count))
        let extra = Array(fresh.dropFirst(reserved.count).prefix(5 - selected.count - reserved.count))
        return reserved + selected + extra
    }
    mutating func answer(_ cardID: String, grade: Int, now: Double) throws {
        guard cards.contains(where: { $0.id == cardID }) else { throw StudyError.unknownCard }
        guard snapshot.visibility[cardID]?.hidden != true else { throw StudyError.hiddenCard }
        if let state = snapshot.states[cardID], state.due > now || state.leech == true { throw StudyError.notDue }
        var next = snapshot
        var state = Scheduler.schedule(next.states[cardID], grade: grade, now: now, cardID: cardID)
        state.__lastReviewAt = max(state.__lastReviewAt ?? -.infinity, now)
        next.states[cardID] = state
        next.reviews.append(LocalReview(id: UUID().uuidString, cardId: cardID, grade: grade, reviewedAt: now, clientId: next.clientID))
        next.answerCount = answersToday(now) + 1; next.answerDay = Self.day(now)
        try disk.save(next); snapshot = next
    }
    mutating func setHidden(_ cardID: String, hidden: Bool, now: Double) throws {
        guard cards.contains(where: { $0.id == cardID }) else { throw StudyError.unknownCard }
        var next = snapshot
        let event = LocalVisibility(id: UUID().uuidString, cardId: cardID, hidden: hidden, at: max(now, (snapshot.visibility[cardID]?.at ?? 0) + 1))
        next.visibility[cardID] = event; next.visibilityEvents.append(event)
        try disk.save(next); snapshot = next
    }
    mutating func applyCloud(baseline: [String: ReviewState], reviews: [LocalReview], visibility: [LocalVisibility], catalog: StudyCatalog, now: Double, kindleDeliveryAt: Double? = nil) throws {
        var next = snapshot
        let received = Set(reviews.map(\.id))
        let receivedVisibility = Set(visibility.map(\.id))
        next.reviews.removeAll { received.contains($0.id) }
        next.visibilityEvents.removeAll { receivedVisibility.contains($0.id) }
        var states = baseline
        for (id, var state) in states where state.intro == nil {
            state.intro = state.__lastReviewAt; states[id] = state
        }
        let ordered = (reviews + next.reviews).sorted { $0.reviewedAt == $1.reviewedAt ? $0.id < $1.id : $0.reviewedAt < $1.reviewedAt }
        for event in ordered {
            if event.reviewedAt <= (states[event.cardId]?.__lastReviewAt ?? -.infinity) { continue }
            var state = Scheduler.schedule(states[event.cardId], grade: event.grade, now: event.reviewedAt, cardID: event.cardId)
            state.__lastReviewAt = event.reviewedAt; states[event.cardId] = state
        }
        next.states = states
        var visibilityStates: [String: LocalVisibility] = [:]
        for event in visibility + next.visibilityEvents {
            if let prior = visibilityStates[event.cardId], prior.at > event.at || (prior.at == event.at && prior.id >= event.id) { continue }
            visibilityStates[event.cardId] = event
        }
        next.visibility = visibilityStates; next.cachedCatalog = catalog; next.lastSyncAt = now
        next.lastKindleDeliveryAt = kindleDeliveryAt
        try disk.save(next); snapshot = next; cards = catalog.cards
    }
    mutating func acknowledge(reviewIDs: Set<String>, visibilityIDs: Set<String>) throws {
        var next = snapshot
        next.reviews.removeAll { reviewIDs.contains($0.id) }
        next.visibilityEvents.removeAll { visibilityIDs.contains($0.id) }
        try disk.save(next); snapshot = next
    }
}

extension Scheduler {
    static func delayLabel(_ ms: Double) -> String {
        func integer(_ n: Double) -> String { String(Int(n.rounded())) }
        func decimal(_ n: Double) -> String {
            let v = (n * 10).rounded() / 10
            return v == v.rounded() ? integer(v) : String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), v)
        }
        let s = ms / 1000
        if s < 60 { return integer(s) + "s" }
        if s < 3600 { return integer(s / 60) + "m" }
        if s < 86400 { return decimal(s / 3600) + "h" }
        let d = s / 86400
        if d < 365.0 / 12 { return integer(d) + "d" }
        if d < 365 { return decimal(d / (365.0 / 12)) + "mo" }
        return decimal(d / 365) + "y"
    }
}
