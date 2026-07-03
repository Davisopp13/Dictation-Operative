import AVFoundation
import Foundation
import os

/// Captures microphone audio and accumulates 16 kHz mono Float32 samples
/// (WhisperKit's input format). A fresh AVAudioEngine is created per session
/// so input-device changes between dictations are picked up cleanly.
final class AudioRecorder {
    static let targetSampleRate: Double = 16_000
    /// Hard cap: 5 minutes of audio (~19 MB of Float32 samples).
    static let maxSamples = Int(targetSampleRate) * 300

    /// RMS level of the latest buffer, called on an arbitrary background queue.
    var onLevel: ((Float) -> Void)?
    /// Fired once when the max-duration cap is hit, on an arbitrary background queue.
    var onMaxDuration: (() -> Void)?

    private var engine: AVAudioEngine?
    private var converter: AVAudioConverter?
    private let queue = DispatchQueue(label: "com.davisopp.dictation.audio")
    private var samples: [Float] = []
    private var maxDurationFired = false

    var isRunning: Bool { engine?.isRunning ?? false }

    func start() throws {
        stopEngine()
        queue.sync {
            samples.removeAll()
            maxDurationFired = false
        }

        let engine = AVAudioEngine()
        let input = engine.inputNode
        // The tap MUST use the hardware format; a mismatched format crashes at runtime.
        let hwFormat = input.outputFormat(forBus: 0)
        guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0 else {
            throw DictationError.noAudioInput
        }
        guard
            let targetFormat = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: Self.targetSampleRate,
                channels: 1,
                interleaved: false
            ),
            let converter = AVAudioConverter(from: hwFormat, to: targetFormat)
        else {
            throw DictationError.audioSetupFailed
        }
        self.converter = converter

        input.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.queue.async {
                self.append(buffer: buffer, targetFormat: targetFormat)
            }
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            self.converter = nil
            Log.audio.error("Engine start failed: \(error.localizedDescription)")
            throw DictationError.audioSetupFailed
        }
        self.engine = engine
    }

    /// Stops capture and returns everything recorded this session.
    func stop() -> [Float] {
        stopEngine()
        return queue.sync {
            let captured = samples
            samples = []
            return captured
        }
    }

    /// Stops capture and discards the audio.
    func cancel() {
        stopEngine()
        queue.sync { samples = [] }
    }

    private func stopEngine() {
        guard let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.engine = nil
        converter = nil
    }

    // Runs on `queue`.
    private func append(buffer: AVAudioPCMBuffer, targetFormat: AVAudioFormat) {
        guard let converter, samples.count < Self.maxSamples else { return }

        let ratio = Self.targetSampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let out = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }

        var provided = false
        var conversionError: NSError?
        let status = converter.convert(to: out, error: &conversionError) { _, outStatus in
            if provided {
                outStatus.pointee = .noDataNow
                return nil
            }
            provided = true
            outStatus.pointee = .haveData
            return buffer
        }
        if let conversionError {
            Log.audio.error("Conversion failed: \(conversionError.localizedDescription)")
            return
        }
        guard status != .error, let channelData = out.floatChannelData else { return }

        let frameCount = Int(out.frameLength)
        guard frameCount > 0 else { return }
        samples.append(contentsOf: UnsafeBufferPointer(start: channelData[0], count: frameCount))

        var sumOfSquares: Float = 0
        for i in 0..<frameCount {
            let sample = channelData[0][i]
            sumOfSquares += sample * sample
        }
        onLevel?((sumOfSquares / Float(frameCount)).squareRoot())

        if samples.count >= Self.maxSamples, !maxDurationFired {
            maxDurationFired = true
            onMaxDuration?()
        }
    }
}
