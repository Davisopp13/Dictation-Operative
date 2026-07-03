import os

enum Log {
    static let app = Logger(subsystem: "com.davisopp.dictation", category: "app")
    static let audio = Logger(subsystem: "com.davisopp.dictation", category: "audio")
    static let transcription = Logger(subsystem: "com.davisopp.dictation", category: "transcription")
    static let cleanup = Logger(subsystem: "com.davisopp.dictation", category: "cleanup")
    static let insertion = Logger(subsystem: "com.davisopp.dictation", category: "insertion")
}
