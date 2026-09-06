import AppKit
import SwiftUI

/// Small floating pill near the bottom of the screen while recording/processing.
/// Uses a non-activating borderless panel so it NEVER steals focus from the
/// app being dictated into.
@MainActor
final class RecordingIndicatorPanel {
    private var panel: NSPanel?

    func show(controller: DictationController) {
        if panel == nil {
            panel = makePanel(controller: controller)
        }
        position()
        panel?.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    /// Shows the panel if there is anything worth showing, hides it otherwise.
    func updateVisibility(for controller: DictationController) {
        let visible = controller.state.isRecording
            || controller.state.isProcessing
            || controller.transientMessage != nil
            || {
                if case .error = controller.state { return true }
                return false
            }()
        if visible {
            show(controller: controller)
        } else {
            hide()
        }
    }

    private func makePanel(controller: DictationController) -> NSPanel {
        // Wide enough for two lines of live transcript; the pill itself sizes
        // to its content and is centred in this transparent frame.
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 96),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let hosting = NSHostingView(rootView: IndicatorView().environment(controller))
        panel.contentView = hosting
        return panel
    }

    private func position() {
        guard let panel, let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        let size = panel.frame.size
        let origin = NSPoint(
            x: frame.midX - size.width / 2,
            y: frame.minY + 80
        )
        panel.setFrameOrigin(origin)
    }
}

private struct IndicatorView: View {
    @Environment(DictationController.self) private var controller

    private var showsPreview: Bool {
        controller.state.isRecording && !controller.livePreview.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: controller.state.symbolName)
                    .foregroundStyle(controller.state.isRecording ? .red : .secondary)

                Text(controller.transientMessage ?? controller.state.label)
                    .font(.callout)
                    .lineLimit(1)

                if controller.state.isRecording {
                    LevelMeter(level: controller.audioLevel)
                }
            }

            if showsPreview {
                previewText
                    .font(.callout)
                    .lineLimit(2)
                    .truncationMode(.head)
                    .frame(maxWidth: 460, alignment: .leading)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(radius: 6, y: 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeOut(duration: 0.15), value: showsPreview)
    }

    /// Confirmed words in the primary colour, the still-changing tail dimmed.
    private var previewText: Text {
        let confirmed = controller.livePreview.confirmedText
        let pending = controller.livePreview.pendingText
        var text = Text(confirmed)
        if !pending.isEmpty {
            text = text + Text(confirmed.isEmpty ? pending : " " + pending).foregroundStyle(.secondary)
        }
        return text
    }
}

private struct LevelMeter: View {
    let level: Float

    private var normalized: CGFloat {
        // Typical speech RMS is ~0.01–0.2; map to a useful visual range.
        min(1, CGFloat(level) * 8)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                Capsule()
                    .fill(.green)
                    .frame(width: max(4, geo.size.width * normalized))
            }
        }
        .frame(width: 60, height: 6)
        .animation(.linear(duration: 0.08), value: normalized)
    }
}
