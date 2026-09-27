import SwiftUI
import Combine
import FirebaseCore
import GoogleSignIn

@main
struct MyAnkiApp: App {
    init() { FirebaseApp.configure() }
    var body: some Scene {
        WindowGroup { StudyView().preferredColorScheme(.dark) }
    }
}

private struct StudyView: View {
    @StateObject private var model = StudyModel()
    @StateObject private var account = AccountSession()
    @Environment(\.scenePhase) private var scenePhase
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let grades = ["Again", "Hard", "Good", "Easy"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Text("My Anki").font(.largeTitle.bold())
                    Spacer()
                    Button { Task { await model.sync(force: true) } } label: {
                        Text(model.syncLabel).font(.caption).foregroundStyle(.secondary)
                            .padding(10).overlay(Capsule().stroke(Color(white: 0.18)))
                    }.disabled(model.isPreview || model.syncing)
                }
                if account.user == nil {
                    Button(account.busy ? "Connecting…" : "Sign in with Google") { Task { await account.signIn() } }
                        .tint(.white).disabled(account.busy)
                } else {
                    HStack {
                        Text(account.user?.email ?? "Your account").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("Sign out") {
                            do { try account.signOut() } catch { account.error = "No se pudo cerrar sesión." }
                        }.font(.caption).tint(.white)
                    }
                }
                ProgressView(value: Double(model.count % 5), total: 5).tint(.white)
                    .accessibilityLabel("\(model.count % 5) of 5 answers")
                cardContent
                if !model.milestone, model.current != nil {
                    if model.revealed {
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 8) { gradeButtons }
                            VStack(spacing: 8) { gradeButtons }
                        }
                    } else {
                        Button("Show answer") { model.revealed = true }
                            .font(.title3.bold()).foregroundStyle(.black)
                            .frame(maxWidth: .infinity).padding(24)
                            .background(.white, in: RoundedRectangle(cornerRadius: 20))
                            .accessibilityIdentifier("showAnswer")
                    }
                }
                if model.undoID != nil {
                    HStack { Text("Card hidden").foregroundStyle(.secondary); Spacer(); Button("Undo") { model.undoHide() } }
                        .font(.footnote).tint(.white)
                }
                if let card = model.current, !model.milestone {
                    Text(card.date.map { "Highlight: \($0)" } ?? "Highlight date unavailable")
                        .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
                if !model.isPreview {
                    if let received = model.engine?.snapshot.lastKindleDeliveryAt {
                        Text("Kindle delivery: \(Date(timeIntervalSince1970: received / 1000).formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("No Kindle delivery recorded yet").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if let error = model.error { Text(error).font(.footnote).foregroundStyle(.red).accessibilityLabel(error) }
                if model.isPreview {
                    Text("Development preview · Reviews stay on this device until you sign in. Preview reviews won't enter your account.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let error = account.error { Text(error).font(.footnote).foregroundStyle(.red) }
            }.padding(24)
        }
        .background {
            Color(white: 0.035)
                .overlay {
                    Canvas { context, size in
                        for x in stride(from: 16.0, through: size.width, by: 28) {
                            for y in stride(from: 16.0, through: size.height, by: 28) {
                                context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 2, height: 2)), with: .color(Color(white: 0.12)))
                            }
                        }
                    }.accessibilityHidden(true)
                }
                .ignoresSafeArea()
        }
        .onReceive(timer) { _ in model.refreshIfEmpty() }
        .task(id: account.user?.uid) { model.setAccount(account.user) }
        .onOpenURL { GIDSignIn.sharedInstance.handle($0) }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.refreshIfEmpty(); Task { await model.sync() } }
        }
    }
    @ViewBuilder private var cardContent: some View {
        VStack(alignment: .leading, spacing: 28) {
            if model.milestone {
                Spacer(minLength: 28)
                Text("\(model.count) reviewed today ✓").font(.title.bold())
                Text("Your next 5 are ready").font(.title3).foregroundStyle(.secondary)
                Spacer(minLength: 28)
            } else if let card = model.current {
                Text("RECALL · \(card.book.uppercased())").font(.caption.bold()).foregroundStyle(.secondary)
                Text(model.revealed ? card.answer : card.question).font(.title2.bold())
                    .accessibilityIdentifier("cardText")
                Divider().overlay(Color(white: 0.17))
                HStack { Spacer(); Button("Hide card") { model.hide() }.foregroundStyle(.secondary).font(.footnote) }
            } else {
                let downloading = !model.isPreview && model.engine?.snapshot.lastSyncAt == nil
                Text(model.error != nil ? "Your cards are safe" : downloading ? "Loading your cards" : "You're all caught up").font(.title2.bold())
                Text(model.error != nil ? "We couldn't open your saved progress." : downloading ? "Restoring your saved progress." : "Come back when you're ready to review.")
                    .foregroundStyle(.secondary)
            }
        }
        .padding(24).frame(maxWidth: .infinity, minHeight: 300, alignment: .topLeading)
        .background(Color(white: 0.065), in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color(white: 0.17)))
        .accessibilityIdentifier(model.milestone ? "milestone" : "studyCard")
    }
    @ViewBuilder private var gradeButtons: some View {
        ForEach(0..<4, id: \.self) { grade in
            Button { model.answer(grade) } label: {
                VStack(spacing: 6) {
                    Text(grades[grade]).font(.body.bold())
                    Text(model.interval(grade)).font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).padding(.vertical, 20).padding(.horizontal, 8)
            }
            .foregroundStyle(.white)
            .background(Color(white: 0.1), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(white: 0.18)))
            .accessibilityLabel("\(grades[grade]), review again in \(model.interval(grade))")
            .accessibilityIdentifier("grade\(grade)")
        }
    }
}
