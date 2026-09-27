import Foundation

final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, [String: Any]))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: body))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}

@main struct CloudTests {
    static func require(_ value: Bool, _ message: String) throws {
        if !value { throw NSError(domain: message, code: 1) }
    }
    static func main() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let api = CloudAPI(uid: "test-user", token: "fake-test-token", session: URLSession(configuration: config))
        let event = LocalReview(id: "stable-id", cardId: "1234567890abcdef", grade: 2, reviewedAt: 1780000000000, clientId: "client-test")
        var writes: [[String: Any]] = []
        StubProtocol.handler = { req in
            try require(req.value(forHTTPHeaderField: "Authorization") == "Bearer fake-test-token", "auth header missing")
            try require(req.url!.path.contains("my-anki-hector"), "wrong project")
            if req.httpMethod == "POST" {
                var data = req.httpBody ?? Data()
                if data.isEmpty, let stream = req.httpBodyStream {
                    stream.open(); defer { stream.close() }
                    var buffer = [UInt8](repeating: 0, count: 4096)
                    while stream.hasBytesAvailable {
                        let read = stream.read(&buffer, maxLength: buffer.count)
                        if read <= 0 { break }
                        data.append(contentsOf: buffer.prefix(read))
                    }
                }
                let body = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                writes.append(body)
                return (409, [:])
            }
            return (200, ["fields": ["cardId": ["stringValue": event.cardId], "grade": ["integerValue": "2"], "clientId": ["stringValue": event.clientId], "reviewedAt": ["timestampValue": CloudAPI.timestamp(event.reviewedAt)]]])
        }
        try await api.send(event); try await api.send(event)
        try require(writes.count == 2, "retry did not use expected requests")
        let first = writes[0]["writes"] as! [[String: Any]], second = writes[1]["writes"] as! [[String: Any]]
        try require((first[0]["update"] as! [String: Any])["name"] as? String == (second[0]["update"] as! [String: Any])["name"] as? String, "retry changed event ID")
        try require((first[0]["currentDocument"] as! [String: Any])["exists"] as? Bool == false, "write could overwrite existing event")
        StubProtocol.handler = { req in
            if req.httpMethod == "POST" { return (409, [:]) }
            return (200, ["fields": ["cardId": ["stringValue": "different-card"]]])
        }
        do { try await api.send(event); throw NSError(domain: "accepted mismatched collision", code: 1) }
        catch CloudError.mismatchedEvent { }
        var pages = 0
        StubProtocol.handler = { req in
            pages += 1
            if pages == 1 { return (200, ["documents": [["name": "projects/test/documents/my_anki/test-user/reviews/a", "fields": [:]]], "nextPageToken": "next-page"]) }
            try require(req.url!.query!.contains("pageToken=next-page"), "pagination token absent")
            return (200, ["documents": [["name": "projects/test/documents/my_anki/test-user/reviews/b", "fields": [:]]]])
        }
        let rows = try await api.list("reviews")
        try require(rows.map(\.id) == ["a", "b"], "pagination lost rows")
        StubProtocol.handler = { _ in (429, [:]) }
        do { try await api.send(event); throw NSError(domain: "quota failure accepted", code: 1) }
        catch CloudError.rejected(429) { }
        print("PASS: immutable REST writes, stable retry ID, verified conflicts, pagination and quota rejection")
    }
}
