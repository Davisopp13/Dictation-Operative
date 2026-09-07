/// Route returning users directly to the missing prerequisite, without replaying setup.
enum SetupProgress {
    static func initialStep(completed: Bool, microphone: Bool, accessibility: Bool, model: Bool) -> Int {
        guard completed else { return 0 }
        if !microphone { return 1 }
        if !accessibility { return 2 }
        if !model { return 3 }
        return 4
    }
}
