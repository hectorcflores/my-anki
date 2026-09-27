import Foundation

struct CloudDocument {
    let id: String
    let fields: [String: Any]
    var createTime: String = ""
}
enum CloudError: Error { case invalidResponse, rejected(Int), mismatchedEvent, invalidData }

/// REST keeps Firestore document metadata explicit. Reads are fully paginated;
/// this version does not invent an incompatible incremental cursor.
struct CloudAPI {
    let uid: String
    let token: String
    let session: URLSession
    init(uid: String, token: String, session: URLSession = .shared) {
        self.uid = uid; self.token = token; self.session = session
    }
    private let base = "https://firestore.googleapis.com/v1/projects/my-anki-hector/databases/(default)/documents"
    private var root: String { "my_anki/\(uid)" }
    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> (Int, [String: Any]) {
        guard let url = URL(string: base + path) else { throw CloudError.invalidResponse }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 30
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CloudError.invalidResponse }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return (http.statusCode, json)
    }
    static func decode(_ value: [String: Any]) throws -> Any {
        if let v = value["stringValue"] { return v }
        if let v = value["booleanValue"] { return v }
        if let v = value["integerValue"] as? String, let n = Double(v) { return n }
        if let v = value["doubleValue"] { return v }
        if let v = value["timestampValue"] { return v }
        if value["nullValue"] != nil { return NSNull() }
        if let map = value["mapValue"] as? [String: Any] { return try decodeFields(map["fields"] as? [String: Any] ?? [:]) }
        if let array = value["arrayValue"] as? [String: Any] {
            return try (array["values"] as? [[String: Any]] ?? []).map { try decode($0) }
        }
        throw CloudError.invalidData
    }
    static func decodeFields(_ fields: [String: Any]) throws -> [String: Any] {
        var result: [String: Any] = [:]
        for (key, value) in fields {
            guard let typed = value as? [String: Any] else { throw CloudError.invalidData }
            result[key] = try decode(typed)
        }
        return result
    }
    func list(_ collection: String) async throws -> [CloudDocument] {
        var documents: [CloudDocument] = []; var page: String?
        repeat {
            var components = URLComponents()
            components.queryItems = [URLQueryItem(name: "pageSize", value: "300")]
            if let page { components.queryItems?.append(URLQueryItem(name: "pageToken", value: page)) }
            let (status, json) = try await request("/\(root)/\(collection)?\(components.percentEncodedQuery ?? "")")
            guard status == 200 else { throw CloudError.rejected(status) }
            for document in json["documents"] as? [[String: Any]] ?? [] {
                guard let name = document["name"] as? String else { throw CloudError.invalidData }
                documents.append(CloudDocument(id: String(name.split(separator: "/").last!), fields: try Self.decodeFields(document["fields"] as? [String: Any] ?? [:]), createTime: document["createTime"] as? String ?? ""))
            }
            page = json["nextPageToken"] as? String
        } while page != nil
        return documents
    }
    func baseline() async throws -> [String: ReviewState] {
        let (status, json) = try await request("/\(root)/meta/baseline")
        if status == 404 { return [:] }
        guard status == 200 else { throw CloudError.rejected(status) }
        let fields = try Self.decodeFields(json["fields"] as? [String: Any] ?? [:])
        guard let state = fields["state"] as? [String: Any] else { throw CloudError.invalidData }
        return try JSONDecoder().decode([String: ReviewState].self, from: JSONSerialization.data(withJSONObject: state))
    }
    private func create(_ collection: String, id: String, fields: [String: Any], matches: ([String: Any]) -> Bool) async throws {
        let name = "projects/my-anki-hector/databases/(default)/documents/\(root)/\(collection)/\(id)"
        let body: [String: Any] = ["writes": [["update": ["name": name, "fields": fields], "updateTransforms": [["fieldPath": "createdAt", "setToServerValue": "REQUEST_TIME"]], "currentDocument": ["exists": false]]]]
        let (status, _) = try await request(":commit", method: "POST", body: body)
        if status == 409 {
            let (readStatus, json) = try await request("/\(root)/\(collection)/\(id)")
            guard readStatus == 200 else { throw CloudError.rejected(readStatus) }
            guard matches(try Self.decodeFields(json["fields"] as? [String: Any] ?? [:])) else { throw CloudError.mismatchedEvent }
        } else if !(200..<300).contains(status) { throw CloudError.rejected(status) }
    }
    static func timestamp(_ ms: Double) -> String {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
    static func milliseconds(_ value: Any?) throws -> Double {
        guard let raw = value as? String else { throw CloudError.invalidData }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return (d.timeIntervalSince1970 * 1000).rounded() }
        f.formatOptions = [.withInternetDateTime]
        guard let d = f.date(from: raw) else { throw CloudError.invalidData }
        return (d.timeIntervalSince1970 * 1000).rounded()
    }
    func send(_ event: LocalReview) async throws {
        try await create("reviews", id: event.id, fields: ["cardId": ["stringValue": event.cardId], "grade": ["integerValue": String(event.grade)], "reviewedAt": ["timestampValue": Self.timestamp(event.reviewedAt)], "clientId": ["stringValue": event.clientId]]) { row in
            row["cardId"] as? String == event.cardId && (row["grade"] as? NSNumber)?.intValue == event.grade && row["clientId"] as? String == event.clientId && abs(((try? Self.milliseconds(row["reviewedAt"])) ?? -.infinity) - event.reviewedAt) < 1
        }
    }
    func send(_ event: LocalVisibility) async throws {
        try await create("visibility", id: event.id, fields: ["id": ["stringValue": event.id], "cardId": ["stringValue": event.cardId], "hidden": ["booleanValue": event.hidden], "at": ["integerValue": String(Int64(event.at))]]) { row in
            row["id"] as? String == event.id && row["cardId"] as? String == event.cardId && row["hidden"] as? Bool == event.hidden && (row["at"] as? NSNumber)?.doubleValue == event.at
        }
    }
    static func reviews(_ docs: [CloudDocument]) throws -> [LocalReview] {
        try docs.map { doc in
            guard let card = doc.fields["cardId"] as? String, let grade = (doc.fields["grade"] as? NSNumber)?.intValue, (0...3).contains(grade), let client = doc.fields["clientId"] as? String else { throw CloudError.invalidData }
            return LocalReview(id: doc.id, cardId: card, grade: grade, reviewedAt: try milliseconds(doc.fields["reviewedAt"]), clientId: client)
        }
    }
    static func visibility(_ docs: [CloudDocument]) throws -> [LocalVisibility] {
        try docs.map { doc in
            guard let card = doc.fields["cardId"] as? String, let hidden = doc.fields["hidden"] as? Bool, let at = (doc.fields["at"] as? NSNumber)?.doubleValue else { throw CloudError.invalidData }
            return LocalVisibility(id: doc.id, cardId: card, hidden: hidden, at: at)
        }
    }
}
