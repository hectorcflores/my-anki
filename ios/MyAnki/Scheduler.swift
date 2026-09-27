import Foundation

struct ReviewState: Codable, Equatable {
    var st = "lrn"
    var step = 0
    var ef = 2.5
    var ivl = 0
    var due: Double = 0
    var reps = 0
    var lapses = 0
    var intro: Double?
    var leech: Bool?
    var __lastReviewAt: Double?
}

enum Scheduler {
    static func hash(_ id: String) -> UInt32 {
        id.utf16.reduce(0) { ($0 &* 31) &+ UInt32($1) }
    }
    static func fuzz(_ n: Int, _ seed: UInt32) -> Int {
        guard n >= 2 else { return n }
        var t = seed &+ 0x6D2B79F5
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        let r = Double(t ^ (t >> 14)) / 4294967296
        if n == 2 { return 2 + Int(r.rounded()) }
        let pct = n < 7 ? 0.25 : n < 30 ? 0.15 : 0.05
        let span = max(1, Int((Double(n) * pct).rounded()))
        return max(1, n - span + Int((r * Double(2 * span)).rounded()))
    }
    static func schedule(_ previous: ReviewState?, grade: Int, now: Double, cardID: String) -> ReviewState {
        precondition((0...3).contains(grade))
        var s = previous ?? ReviewState(intro: now)
        func fz(_ n: Int) -> Int { fuzz(n, hash(cardID) &+ UInt32(truncatingIfNeeded: s.reps)) }
        func days(_ n: Int) { s.due = now + Double(n) * 86400000; s.ivl = n }
        if s.st == "lrn" {
            if grade == 0 { s.step = 0; s.due = now + 60000 }
            else if grade == 1 { s.due = now + (s.step == 0 ? 330000 : 600000) }
            else if grade == 2 {
                if s.step + 1 >= 2 { s.st = "rev"; s.reps += 1; days(fz(1)) }
                else { s.step += 1; s.due = now + 600000 }
            } else { s.st = "rev"; s.reps += 1; days(fz(4)) }
            return s
        }
        if s.st == "rel" {
            if grade <= 1 { s.due = now + 600000 }
            else { s.st = "rev"; s.reps += 1; days(fz(max(1, s.ivl == 0 ? 1 : s.ivl) + (grade == 3 ? 1 : 0))) }
            return s
        }
        let interval = s.ivl == 0 ? 1 : s.ivl
        if grade == 0 {
            s.st = "rel"; s.step = 0; s.lapses += 1
            if s.lapses >= 8 { s.leech = true }
            s.ef = max(1.3, s.ef - 0.2); s.ivl = 1; s.due = now + 600000
            return s
        }
        s.reps += 1
        let hard = fz(max(interval + 1, Int((Double(interval) * 1.2).rounded())))
        let good = max(hard + 1, fz(Int((Double(interval) * s.ef).rounded())))
        let easy = max(good + 1, fz(Int((Double(interval) * s.ef * 1.3).rounded())))
        if grade == 1 { s.ef = max(1.3, s.ef - 0.15); days(hard) }
        else if grade == 2 { days(good) }
        else { s.ef += 0.15; days(easy) }
        return s
    }
}
