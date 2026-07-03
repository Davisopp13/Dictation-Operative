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
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 260, height: 44),
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

    var body: some View {
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
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: Capsule())
        .shadow(radius: 6, y: 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
