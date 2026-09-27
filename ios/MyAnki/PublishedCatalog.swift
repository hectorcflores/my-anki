import Foundation

enum PublishedCatalog {
    static func download(session: URLSession = .shared) async throws -> StudyCatalog {
        let url = URL(string: "https://hectorcflores.github.io/my-anki/app/catalog.json")!
        var request = URLRequest(url: url); request.timeoutInterval = 15; request.cachePolicy = .reloadRevalidatingCacheData
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw CloudError.invalidResponse }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard (json?["schemaVersion"] as? NSNumber)?.intValue == 1 else { throw CloudError.invalidData }
        let catalog = try JSONDecoder().decode(StudyCatalog.self, from: data)
        guard !catalog.books.isEmpty, !catalog.cards.isEmpty else { throw CloudError.invalidData }
        let ids = catalog.cards.map(\.id)
        guard Set(ids).count == ids.count, ids.allSatisfy({ $0.range(of: "^[a-f0-9]{16}$", options: .regularExpression) != nil }) else { throw CloudError.invalidData }
        return catalog
    }
}
