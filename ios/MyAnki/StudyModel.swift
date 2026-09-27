import Foundation
import Combine
import CryptoKit
import FirebaseAuth
import Network

@MainActor
final class StudyModel: ObservableObject {
    @Published private(set) var engine: StudyEngine?
    @Published private(set) var current: StudyCard?
    @Published var revealed = false
    @Published private(set) var milestone = false
    @Published private(set) var error: String?
    @Published private(set) var undoID: String?
    @Published private(set) var syncing = false
    @Published private(set) var syncFailed = false
    private let networkMonitor = NWPathMonitor()
    private var retryTask: Task<Void, Never>?
    private var retryCount = 0
    private var user: FirebaseAuth.User?
    private var milestoneTask: Task<Void, Never>?
    private var batch: [StudyCard] = []
    private var baseCatalog: StudyCatalog?
    private var lastAttempt: Double = 0
    var now: Double { (Date().timeIntervalSince1970 * 1000).rounded(.down) }
    var count: Int { engine?.answersToday(now) ?? 0 }
    var isPreview: Bool { user == nil }
    var syncLabel: String {
        if isPreview { return "Local preview" }
        if syncing { return "Syncing" }
        if syncFailed { return "Saved on device" }
        if let engine, !engine.snapshot.reviews.isEmpty || !engine.snapshot.visibilityEvents.isEmpty { return "Pending sync" }
        return engine?.snapshot.lastSyncAt == nil ? "Connecting" : "Synced"
    }

    init() {
        load(accountID: "development-local")
        networkMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in await self?.sync(force: true) }
        }
        networkMonitor.start(queue: DispatchQueue(label: "MyAnki.connectivity"))
    }
    deinit { networkMonitor.cancel() }
    private func load(accountID: String) {
        milestoneTask?.cancel(); milestone = false; revealed = false; undoID = nil; current = nil; batch = []; engine = nil
        do {
            guard let url = Bundle.main.url(forResource: "catalog", withExtension: "json") else { throw CocoaError(.fileNoSuchFile) }
            let catalog = try JSONDecoder().decode(StudyCatalog.self, from: Data(contentsOf: url)); baseCatalog = catalog
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let filename = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
            let disk = StudyDisk(url: directory.appendingPathComponent("MyAnki/\(filename).json"), accountID: accountID)
            engine = try StudyEngine(cards: catalog.cards, disk: disk)
            error = nil; syncFailed = false
            if accountID == "development-local" || engine?.snapshot.lastSyncAt != nil { nextBatch() }
        } catch { self.error = "No se pudo abrir el almacenamiento. Tus datos no se han borrado." }
    }
    func setAccount(_ nextUser: FirebaseAuth.User?) {
        guard user?.uid != nextUser?.uid else { return }
        retryTask?.cancel(); retryCount = 0
        user = nextUser; lastAttempt = 0
        load(accountID: nextUser?.uid ?? "development-local")
        Task { await sync(force: true) }
    }
    func interval(_ grade: Int) -> String {
        guard let current, let engine else { return "" }
        let time = now
        return Scheduler.delayLabel(Scheduler.schedule(engine.snapshot.states[current.id], grade: grade, now: time, cardID: current.id).due - time)
    }
    func answer(_ grade: Int) {
        guard revealed, !milestone, let card = current, var updated = engine else { return }
        do {
            try updated.answer(card.id, grade: grade, now: now)
            engine = updated; error = nil; revealed = false
            batch.removeAll { $0.id == card.id }; current = batch.first
            if count % 5 == 0 {
                milestone = true; milestoneTask?.cancel()
                milestoneTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(2))
                    guard !Task.isCancelled else { return }
                    self?.milestone = false; self?.nextBatch()
                }
            } else if current == nil { nextBatch() }
            Task { await sync(force: true, pushOnly: true) }
        } catch { self.error = "No se pudo guardar tu respuesta. Intenta de nuevo; la tarjeta sigue aquí." }
    }
    func hide() {
        guard let card = current, !milestone, var updated = engine else { return }
        do {
            try updated.setHidden(card.id, hidden: true, now: now)
            engine = updated; undoID = card.id; error = nil; revealed = false
            batch.removeAll { $0.id == card.id }; current = batch.first
            if current == nil { nextBatch() }
            Task { await sync(force: true, pushOnly: true) }
        } catch { self.error = "No se pudo guardar este cambio. La tarjeta sigue visible." }
    }
    func undoHide() {
        guard let id = undoID, var updated = engine else { return }
        do {
            try updated.setHidden(id, hidden: false, now: now)
            engine = updated; undoID = nil; error = nil
            if let card = updated.queue(now: now).first(where: { $0.id == id }) {
                batch.removeAll { $0.id == id }; batch.insert(card, at: 0); current = card; revealed = false
            }
            Task { await sync(force: true, pushOnly: true) }
        } catch { self.error = "No se pudo restaurar la tarjeta. Intenta de nuevo." }
    }
    func refreshIfEmpty() {
        if current == nil && !milestone && (isPreview || engine?.snapshot.lastSyncAt != nil) { nextBatch() }
    }
    private func nextBatch() {
        batch = engine?.queue(now: now) ?? []; current = batch.first; revealed = false
    }
    func sync(force: Bool = false, pushOnly: Bool = false) async {
        guard let user, let engine, let catalog = baseCatalog, !syncing else { return }
        guard force || now - lastAttempt >= 60000 else { return }
        syncing = true; lastAttempt = now
        let uid = user.uid
        defer {
            syncing = false
            if self.user?.uid != uid { Task { await sync(force: true) } }
            else if !syncFailed, let pending = self.engine, !pending.snapshot.reviews.isEmpty || !pending.snapshot.visibilityEvents.isEmpty {
                Task { await sync(force: true, pushOnly: true) }
            }
        }
        do {
            let token = try await user.getIDToken()
            let api = CloudAPI(uid: uid, token: token)
            // Send a stable snapshot. New answers during awaits remain in the local outbox.
            for event in engine.snapshot.reviews { try await api.send(event) }
            for event in engine.snapshot.visibilityEvents { try await api.send(event) }
            if pushOnly {
                guard self.user?.uid == uid, var updated = self.engine else { return }
                try updated.acknowledge(reviewIDs: Set(engine.snapshot.reviews.map(\.id)), visibilityIDs: Set(engine.snapshot.visibilityEvents.map(\.id)))
                self.engine = updated; syncFailed = false
                return
            }
            let baseline = try await api.baseline()
            let remoteReviews = try CloudAPI.reviews(await api.list("reviews"))
            let remoteVisibility = try CloudAPI.visibility(await api.list("visibility"))
            let imports = try await api.list("imports")
            let latestDelivery = imports.compactMap { try? CloudAPI.milliseconds($0.fields["collectedAt"]) }.max()
            let published = (try? await PublishedCatalog.download()) ?? engine.snapshot.cachedCatalog ?? catalog
            let merged = try published.merging(imports)
            guard self.user?.uid == uid, var updated = self.engine else { return }
            // Do not replace a revealed answer while the user is reading it.
            guard !revealed else { return }
            let keepID = current?.id
            try updated.applyCloud(baseline: baseline, reviews: remoteReviews, visibility: remoteVisibility, catalog: merged, now: now, kindleDeliveryAt: latestDelivery)
            self.engine = updated; syncFailed = false; error = nil; retryCount = 0; retryTask?.cancel()
            if !milestone {
                nextBatch()
                if let keepID, let index = batch.firstIndex(where: { $0.id == keepID }) {
                    let keep = batch.remove(at: index); batch.insert(keep, at: 0); current = keep
                }
            }
        } catch {
            guard self.user?.uid == uid else { return }
            syncFailed = true
            if retryCount < 3 {
                let delays = [5.0, 15.0, 60.0]
                let delay = delays[retryCount]; retryCount += 1
                retryTask?.cancel()
                retryTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(delay))
                    guard !Task.isCancelled, self?.user?.uid == uid else { return }
                    await self?.sync(force: true)
                }
            }
            if self.engine?.snapshot.lastSyncAt == nil { self.error = "No se pudo descargar tu historial. Intenta sincronizar de nuevo con internet." }
        }
    }
}
