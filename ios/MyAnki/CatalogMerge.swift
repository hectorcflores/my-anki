import Foundation
import CryptoKit

extension StudyCatalog {
    static func normalized(_ text: String) -> String {
        text.precomposedStringWithCompatibilityMapping.lowercased(with: Locale(identifier: "en_US"))
            .replacingOccurrences(of: "[‘’‚‛]", with: "'", options: .regularExpression)
            .replacingOccurrences(of: "[“”„‟]", with: "\"", options: .regularExpression)
            .replacingOccurrences(of: "[–—−]", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "…", with: "...")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static func sameText(_ a: String, _ b: String) -> Bool {
        let left = normalized(a), right = normalized(b)
        guard !left.isEmpty, !right.isEmpty else { return false }
        if left == right { return true }
        let short = left.count <= right.count ? left : right
        let long = left.count <= right.count ? right : left
        return short.utf16.count >= 20 && long.hasPrefix(short)
    }
    func merging(_ batches: [CloudDocument]) throws -> StudyCatalog {
        var imported: [String: Book] = [:]; var keys: [String] = []
        for batch in batches.sorted(by: {
            let a = Self.timestampOrder($0.createTime), b = Self.timestampOrder($1.createTime)
            return a == b ? $0.id < $1.id : a < b
        }) {
            guard let books = batch.fields["books"] as? [[String: Any]] else { throw CloudError.invalidData }
            for raw in books {
                let title = raw["title"] as? String ?? "Untitled", asin = raw["asin"] as? String ?? ""
                let key = "\(asin)|\(title)"
                if imported[key] == nil { imported[key] = Book(title: title, highlights: []); keys.append(key) }
                var highlights = imported[key]!.highlights
                for h in raw["highlights"] as? [[String: Any]] ?? [] {
                    guard let text = h["text"] as? String, !text.isEmpty else { continue }
                    let location: String
                    if let n = h["location"] as? NSNumber {
                        let value = n.doubleValue
                        location = value == value.rounded() ? String(Int64(value)) : n.stringValue
                    } else {
                        let rawLocation = h["location"] as? String ?? "0"
                        location = rawLocation.isEmpty ? "0" : rawLocation
                    }
                    let source = "\(key)|\(location)|\(text)"
                    let id = SHA256.hash(data: Data(source.utf8)).map { String(format: "%02x", $0) }.joined().prefix(16)
                    let time = h["highlightedAt"] as? String ?? h["date"] as? String
                    let candidate = Book.Highlight(id: String(id), text: text, q: "What is the key idea in this highlight?", date: time.map { String($0.prefix(10)) }, highlightedAt: time, aligned: nil)
                    if let i = highlights.firstIndex(where: { $0.id == id }) {
                        if time != nil { highlights[i] = candidate }
                    } else { highlights.append(candidate) }
                }
                imported[key] = Book(title: title, highlights: highlights)
            }
        }
        var merged = self.books
        for key in keys {
            let incoming = imported[key]!
            if let index = merged.firstIndex(where: { Self.normalized($0.title) == Self.normalized(incoming.title) }) {
                var highlights = merged[index].highlights
                for highlight in incoming.highlights {
                    if let i = highlights.firstIndex(where: { Self.sameText($0.text, highlight.text) }) {
                        let current = highlights[i]
                        if highlight.highlightedAt != nil {
                            highlights[i] = Book.Highlight(id: current.id, text: current.text, q: current.q, date: highlight.date, highlightedAt: highlight.highlightedAt, aligned: current.aligned)
                        }
                    } else { highlights.append(highlight) }
                }
                merged[index] = Book(title: merged[index].title, highlights: highlights)
            } else { merged.append(incoming) }
        }
        return StudyCatalog(books: merged)
    }
    private static func timestampOrder(_ timestamp: String) -> String {
        let parts = timestamp.replacingOccurrences(of: "Z", with: "").split(separator: ".", maxSplits: 1)
        guard let first = parts.first else { return "" }
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        return String(first) + "." + String((fraction + "000000000").prefix(9))
    }
}
