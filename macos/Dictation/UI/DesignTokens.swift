import AppKit
import SwiftUI

/// The shared vocabulary for the interface: "Stage and Page".
///
/// **Stage** is the act of speaking — the floating recording panel. It is a
/// fixed, deliberately dark brand surface and does NOT follow the system
/// appearance; the values below are literal so the Stage looks the same on
/// every Mac.
///
/// **Page** is everything else — Settings, onboarding, the menu. Those keep
/// SwiftUI's system semantic colours so they follow the user's appearance,
/// accent colour, and accessibility settings. See `Tokens.Chrome`.
enum Tokens {

    // MARK: - Stage (fixed brand colours)

    enum Stage {
        /// Deepest navy — the bottom of the panel gradient.
        static let deep = Color(red: 0x01 / 255, green: 0x0a / 255, blue: 0x2d / 255)
        /// Mid navy — the top of the panel gradient.
        static let mid = Color(red: 0x04 / 255, green: 0x12 / 255, blue: 0x33 / 255)
        /// Lifted navy — controls and wells sitting on the Stage.
        static let lift = Color(red: 0x0b / 255, green: 0x2f / 255, blue: 0x7a / 255)
        /// Primary text on the Stage, and the confirmed transcript prefix.
        static let ink = Color.white
        /// Secondary text on the Stage.
        static let muted = Color(red: 0x9c / 255, green: 0xb4 / 255, blue: 0xe8 / 255)
        /// The still-changing tail of the live transcript.
        static let pending = Color(red: 0x6f / 255, green: 0x86 / 255, blue: 0xb8 / 255)
        /// The level meter and other active accents on the Stage.
        static let accent = Color(red: 0x6e / 255, green: 0xa8 / 255, blue: 0xff / 255)
        /// The recording dot. Also the menu bar tint while listening.
        static let live = Color(red: 0xff / 255, green: 0x5a / 255, blue: 0x5f / 255)
    }

    // MARK: - Brand / semantic

    enum Brand {
        static let primary = Color(red: 0x24 / 255, green: 0x5c / 255, blue: 0xe5 / 255)
        static let success = Color(red: 0x1a / 255, green: 0x7a / 255, blue: 0x5e / 255)
        static let warning = Color(red: 0xa2 / 255, green: 0x76 / 255, blue: 0x1f / 255)
        static let danger = Color(red: 0xb8 / 255, green: 0x38 / 255, blue: 0x2f / 255)
    }

    // MARK: - Page chrome
    //
    // Deliberately thin: these are SwiftUI's system semantics, named once so
    // the Page keeps following the user's appearance instead of drifting into
    // hard-coded greys.

    enum Chrome {
        static let text = Color.primary
        static let secondaryText = Color.secondary
        static let well = HierarchicalShapeStyle.quaternary
        static let separator = Color(nsColor: .separatorColor)
    }

    // MARK: - Spacing

    enum Space {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 32
        static let xxl: CGFloat = 48
        static let xxxl: CGFloat = 64
    }

    // MARK: - Corner radius

    enum Radius {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 13
        static let lg: CGFloat = 16
        static let xl: CGFloat = 22
    }

    // MARK: - Window sizes

    enum Size {
        /// The setup window. Read by both `OnboardingView` and its window controller.
        static let onboarding = CGSize(width: 560, height: 570)
        /// Settings opens at this size and can be resized down to `settingsMinimum`.
        static let settings = CGSize(width: 620, height: 520)
        static let settingsMinimum = CGSize(width: 520, height: 420)
        /// The transparent frame the Stage panel is centred inside.
        static let stagePanel = CGSize(width: 560, height: 150)
    }

    // MARK: - Menu bar

    /// A menu bar icon for `state`.
    ///
    /// Ready is a template image so it stays monochrome and quiet, exactly like
    /// every other menu bar extra. The states that mean *something is happening
    /// or needs you* get colour, via dynamic `NSColor`s so they read on both a
    /// light and a dark menu bar.
    @MainActor
    static func menuBarImage(for state: DictationState) -> NSImage? {
        let name = state.symbolName
        guard let base = NSImage(systemSymbolName: name, accessibilityDescription: state.label) else {
            return nil
        }
        guard let tint = menuBarTint(for: state) else {
            base.isTemplate = true
            return base
        }
        let configured = base.withSymbolConfiguration(
            NSImage.SymbolConfiguration(paletteColors: [tint])
        ) ?? base
        configured.isTemplate = false
        configured.accessibilityDescription = state.label
        return configured
    }

    private static func menuBarTint(for state: DictationState) -> NSColor? {
        switch state {
        case .idle:
            return nil
        case .recording:
            return dynamic(light: Stage.live, dark: Stage.live)
        case .transcribing, .cleaning, .inserting:
            return dynamic(light: Brand.primary, dark: Stage.accent)
        case .needsSetup:
            // The warning token is deliberately deep; lift it for a dark menu bar.
            return dynamicColor(
                light: NSColor(Brand.warning),
                dark: NSColor(Brand.warning).blended(withFraction: 0.45, of: .white) ?? NSColor(Brand.warning)
            )
        case .error:
            return dynamic(light: Brand.danger, dark: Stage.live)
        }
    }

    /// A colour that resolves differently against a light and a dark menu bar.
    private static func dynamic(light: Color, dark: Color) -> NSColor {
        dynamicColor(light: NSColor(light), dark: NSColor(dark))
    }

    private static func dynamicColor(light lightColor: NSColor, dark darkColor: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.aqua, .darkAqua])
            return match == .darkAqua ? darkColor : lightColor
        }
    }
}

// MARK: - Shared pieces

/// The one prominent action in a view. Used on the Stage, where the system
/// accent would clash with the fixed navy.
struct StageButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.medium))
            .foregroundStyle(Tokens.Stage.ink)
            .padding(.horizontal, Tokens.Space.sm)
            .padding(.vertical, Tokens.Space.xs - 2)
            .background(
                RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous)
                    .fill(prominent ? Tokens.Stage.lift : Tokens.Stage.ink.opacity(0.10))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous)
                    .strokeBorder(Tokens.Stage.ink.opacity(prominent ? 0.22 : 0.14))
            )
            .opacity(configuration.isPressed ? 0.72 : 1)
            .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous))
    }
}

extension ButtonStyle where Self == StageButtonStyle {
    static var stage: StageButtonStyle { StageButtonStyle() }
    static var stageProminent: StageButtonStyle { StageButtonStyle(prominent: true) }
}

extension View {
    /// A recessed card on the Page — used for the onboarding troubleshooting
    /// note and anything else that is an aside rather than a control.
    func sectionCard() -> some View {
        padding(Tokens.Space.sm)
            .background(
                Tokens.Chrome.well.opacity(0.5),
                in: RoundedRectangle(cornerRadius: Tokens.Radius.sm, style: .continuous)
            )
    }
}
