import Foundation
import Combine
import FirebaseCore
import FirebaseAuth
import GoogleSignIn
import UIKit

@MainActor
final class AccountSession: ObservableObject {
    @Published private(set) var user: FirebaseAuth.User?
    @Published private(set) var busy = false
    @Published var error: String?
    private var listener: AuthStateDidChangeListenerHandle?
    init() {
        listener = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in self?.user = user }
        }
    }
    func signIn() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            guard let clientID = FirebaseApp.app()?.options.clientID,
                  let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
                  let root = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { throw SessionError.unavailable }
            var presenter = root
            while let next = presenter.presentedViewController { presenter = next }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard let token = result.user.idToken?.tokenString else { throw SessionError.unavailable }
            let credential = GoogleAuthProvider.credential(withIDToken: token, accessToken: result.user.accessToken.tokenString)
            _ = try await Auth.auth().signIn(with: credential)
            error = nil
        } catch {
            self.error = "No se pudo iniciar sesión. Puedes intentarlo de nuevo."
        }
    }
    func signOut() throws {
        try Auth.auth().signOut(); GIDSignIn.sharedInstance.signOut()
    }
    enum SessionError: Error { case unavailable }
}
