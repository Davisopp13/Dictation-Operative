import AppKit
import SwiftUI

/// The Stage: a floating bar near the bottom of the screen while recording,
/// processing, or reporting something.
///
/// It is a non-activating panel that can never become key, so clicking Stop or
/// Cancel does NOT move focus away from the app being dictated into — that
/// focus is what insertion depends on. It does accept mouse events while it is
/// on screen, and orders out (accepting nothing) the rest of the time.
@MainActor
final class RecordingIndicatorPanel {
    private var panel: StagePanel?

    /// Fixed Stage width. The height follows the content and is reported back
    /// from SwiftUI, so the panel is never larger than what it draws — an
    /// oversized transparent frame would swallow clicks meant for the app below.
    private static let width: CGFloat = 560

    func show(controller: DictationController) {
        let panel = panel ?? makePanel(controller: controller)
        self.panel = panel
        panel.ignoresMouseEvents = false
        panel.reanchor()
        panel.orderFrontRegardless()
    }

    func hide() {
        // Ordered out, and belt-and-braces: an off-screen panel intercepts nothing.
        panel?.ignoresMouseEvents = true
        panel?.orderOut(nil)
    }

    /// Shows the panel if there is anything worth showing, hides it otherwise.
    func updateVisibility(for controller: DictationController) {
        let state = controller.state
        let visible = state.isRecording
            || state.isProcessing
            || state.needsSetup
            || state.isError
            || controller.transientMessage != nil
        if visible {
            show(controller: controller)
        } else {
            hide()
        }
    }

    private func makePanel(controller: DictationController) -> StagePanel {
        let panel = StagePanel(
            contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 64),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.animationBehavior = .none

        let root = StageView(width: Self.width) { [weak panel] height in
            panel?.setStageHeight(height)
        }
        .environment(controller)

        let hosting = StageHostingView(rootView: root)
        hosting.wantsLayer = true
        panel.contentView = hosting
        return panel
    }
}

/// A panel that never takes key or main status, and keeps itself anchored to
/// the bottom centre of the active screen however its content resizes.
private final class StagePanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    private static let bottomInset: CGFloat = 80

    override func setFrame(_ frameRect: NSRect, display flag: Bool) {
        super.setFrame(anchored(frameRect), display: flag)
    }

    func reanchor() {
        super.setFrame(anchored(frame), display: true)
    }

    func setStageHeight(_ height: CGFloat) {
        let rounded = (height * 2).rounded() / 2
        guard rounded > 0, abs(rounded - frame.height) > 0.5 else { return }
        var rect = frame
        rect.size.height = rounded
        setFrame(rect, display: true)
    }

    private func anchored(_ rect: NSRect) -> NSRect {
        guard let visible = (screen ?? NSScreen.main)?.visibleFrame else { return rect }
        var anchored = rect
        anchored.origin = NSPoint(
            x: visible.midX - rect.width / 2,
            y: visible.minY + Self.bottomInset
        )
        return anchored
    }
}

/// The panel is never key, so every click into it is a "first mouse". Without
/// this the controls would need a click to focus the panel first — which is
/// exactly what must not happen.
private final class StageHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    required init(rootView: Content) {
        super.init(rootView: rootView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }
}

// MARK: - Stage view

private struct StageHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct StageView: View {
    @Environment(DictationController.self) private var controller

    let width: CGFloat
    let onHeightChange: (CGFloat) -> Void

    private var showsPreview: Bool {
        controller.state.isRecording && !controller.livePreview.isEmpty
    }

    /// Transient messages take over the line; otherwise the state speaks.
    private var headline: String {
        controller.transientMessage ?? controller.state.label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.xs) {
            HStack(spacing: Tokens.Space.sm) {
                leading

                Text(headline)
                    .font(.callout)
                    .foregroundStyle(Tokens.Stage.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                if controller.state.isRecording {
                    LevelMeter(level: controller.audioLevel)
                }

                Spacer(minLength: Tokens.Space.xs)

                controls
            }

            if showsPreview {
                previewText
                    .font(.callout)
                    .lineLimit(2)
                    .truncationMode(.head)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, Tokens.Space.md)
        .padding(.vertical, Tokens.Space.sm)
        .frame(width: width, alignment: .leading)
        .background(stageBackground)
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: StageHeightKey.self, value: proxy.size.height)
            }
        )
        .onPreferenceChange(StageHeightKey.self) { height in
            Task { @MainActor in onHeightChange(height) }
        }
        .animation(.easeOut(duration: 0.15), value: showsPreview)
        .animation(.easeOut(duration: 0.15), value: headline)
    }

    /// The navy gradient that IS the Stage. Fixed — it does not follow the
    /// system appearance.
    private var stageBackground: some View {
        RoundedRectangle(cornerRadius: Tokens.Radius.xl, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [Tokens.Stage.mid, Tokens.Stage.deep],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.xl, style: .continuous)
                    .strokeBorder(Tokens.Stage.lift.opacity(0.65), lineWidth: 1)
            )
    }

    @ViewBuilder
    private var leading: some View {
        if controller.state.isRecording {
            LiveDot()
        } else if controller.state.isIndeterminate {
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.small)
                .tint(Tokens.Stage.accent)
                .frame(width: 16, height: 16)
        } else {
            Image(systemName: controller.state.symbolName)
                .foregroundStyle(statusTint)
                .frame(width: 16, height: 16)
        }
    }

    private var statusTint: Color {
        switch controller.state {
        case .error: return Tokens.Stage.live
        case .needsSetup: return Tokens.Stage.accent
        default: return Tokens.Stage.muted
        }
    }

    /// Every state that can be acted on gets an on-screen way to act on it.
    /// Before this the only exits from a recording were the hotkey and the
    /// menu bar.
    @ViewBuilder
    private var controls: some View {
        if controller.state.isRecording {
            HStack(spacing: Tokens.Space.xs) {
                Button("Cancel") { controller.cancel() }
                    .buttonStyle(.stage)
                Button("Stop & Insert") { controller.stopAndProcess() }
                    .buttonStyle(.stageProminent)
            }
        } else if controller.state.isProcessing {
            Button("Cancel") { controller.cancel() }
                .buttonStyle(.stage)
        } else if controller.state.needsSetup {
            HStack(spacing: Tokens.Space.xs) {
                Button("Not Now") { controller.dismissStatus() }
                    .buttonStyle(.stage)
                Button("Open Setup") { controller.openSetup() }
                    .buttonStyle(.stageProminent)
            }
        } else if controller.state.isError {
            Button("Dismiss") { controller.dismissStatus() }
                .buttonStyle(.stage)
        }
    }

    /// Confirmed words in stage ink, the still-changing tail in stage pending.
    private var previewText: Text {
        let confirmed = controller.livePreview.confirmedText
        let pending = controller.livePreview.pendingText
        var text = Text(confirmed).foregroundStyle(Tokens.Stage.ink)
        if !pending.isEmpty {
            text = text + Text(confirmed.isEmpty ? pending : " " + pending)
                .foregroundStyle(Tokens.Stage.pending)
        }
        return text
    }
}

private struct LiveDot: View {
    @State private var pulsing = false

    var body: some View {
        Circle()
            .fill(Tokens.Stage.live)
            .frame(width: 10, height: 10)
            .opacity(pulsing ? 0.45 : 1)
            .frame(width: 16, height: 16)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) {
                    pulsing = true
                }
            }
            .accessibilityLabel("Recording")
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
                Capsule().fill(Tokens.Stage.ink.opacity(0.14))
                Capsule()
                    .fill(Tokens.Stage.accent)
                    .frame(width: max(4, geo.size.width * normalized))
            }
        }
        .frame(width: 60, height: 6)
        .animation(.linear(duration: 0.08), value: normalized)
        .accessibilityHidden(true)
    }
}
