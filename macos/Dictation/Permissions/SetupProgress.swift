/// Route returning users directly to the missing prerequisite, without replaying setup.
enum SetupProgress {
    static func initialStep(completed: Bool, microphone: Bool, accessibility: Bool, model: Bool) -> Int {
        guard completed else { return 0 }
        if !microphone { return 1 }
        if !accessibility { return 2 }
        if !model { return 3 }
        return 4
    }

    /// Sync needs no microphone, no accessibility access and no speech model,
    /// so a step that is holding setup up also offers a way straight to it.
    static func offersSyncEscape(step: Int, canContinue: Bool) -> Bool {
        (1...3).contains(step) && !canContinue
    }
}
