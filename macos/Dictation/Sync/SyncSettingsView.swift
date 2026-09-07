import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

struct SyncSettingsView: View {
  @Environment(SyncService.self) private var sync
  @State private var code = ""
  @State private var legacyCode = ""
  var body: some View {
    @Bindable var sync = sync
    Form {
      Section("This device") {
        HStack {
          TextField("Name", text: $sync.config.device.name).disabled(sync.pairing != nil).onChange(of: sync.config.device.name) {
            _, value in if value.count > 60 { sync.config.device.name = String(value.prefix(60)) }
          }
          Button("Save", action: sync.rename).disabled(sync.busy || sync.pairing != nil)
        }
        Toggle("Pause Sync", isOn: $sync.config.paused).onChange(of: sync.config.paused) { _, _ in
          sync.persist(reset: true)
        }.disabled(sync.busy || sync.pairing != nil)
        Text(sync.status).font(.caption).textSelection(.enabled)
        if let error = sync.error { Text(error).font(.caption).foregroundStyle(.red) }
        if sync.busy { ProgressView(value: sync.progress) }
      }
      Section("Trusted devices") {
        if sync.config.pairs.isEmpty {
          ContentUnavailableView {
            Label("No trusted devices", systemImage: "laptopcomputer.and.iphone")
          } description: {
            Text("Pair a device below to send and receive clipboard text.")
          }
        } else {
          Picker("Send to", selection: $sync.config.selected) {
            Text("Choose a device").tag("")
            ForEach(sync.config.pairs) { pair in Text(pair.peerName).tag(pair.id) }
          }.onChange(of: sync.config.selected) { _, _ in sync.persist(reset: true) }.disabled(
            sync.busy)
          HStack {
            Button("Send clipboard", action: sync.sendClipboard).disabled(!sync.available)
            Button("Receive latest", action: sync.receiveLatest).disabled(!sync.available)
            Button("Remove", role: .destructive, action: sync.remove).disabled(
              sync.pair == nil || sync.busy)
          }
        }
        if sync.pair?.role == "host", sync.state?.approved == false, let guest = sync.state?.guest {
          Button("Trust and pair “\(guest.name)”", action: sync.approve).disabled(sync.busy || sync.pairing != nil)
        }
        Toggle("Automatically send and receive clipboard changes", isOn: $sync.config.automatic)
          .onChange(of: sync.config.automatic) { _, _ in sync.persist(reset: true) }
        Toggle("Send completed dictation to selected device", isOn: $sync.config.sendDictation)
          .onChange(of: sync.config.sendDictation) { _, _ in sync.persist() }
        Text(
          "Automatic sync works while this Mac is awake and Dictation is running. It can send sensitive copied text; known concealed clipboard items are skipped. Reconnection never automatically pastes an older transfer."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Pair another device") {
        if let pending = sync.pairing, let state = sync.pairingState {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = max(0, Int((Double(state.expiresAt) / 1000 - context.date.timeIntervalSince1970).rounded(.up)))
            if seconds == 0 || sync.pairingExpired {
              Text("Code expired or cancelled").font(.headline)
              Text("Create a new code and try again.")
              HStack {
                Button("Create new code", action: sync.createInvitation).disabled(sync.busy)
                Button("Dismiss", action: sync.cancelPairing).disabled(sync.busy)
              }
            } else {
              if pending.role == "host" && state.guest == nil {
                VStack(alignment: .leading, spacing: 12) {
                  Text("Scan with your phone’s camera").font(.headline)
                  PairingQRCode(value: pending.link)
                  Text("Or open Sync on your other device and enter:")
                  HStack {
                    Text(pending.displayCode).font(.system(size: 28, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                    Button("Copy code") {
                      NSPasteboard.general.clearContents()
                      NSPasteboard.general.setString(pending.code, forType: .string)
                    }
                  }
                }
              } else {
                Text(pending.role == "host" ? "Pair with “\(state.guest?.device.name ?? "Device")”?" : "Waiting for “\(state.host.device.name)”")
                  .font(.headline)
                Text("Check that this confirmation matches on both devices.")
                Text(sync.pairingVerification).font(.system(size: 20, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                if pending.role == "host" {
                  Button("They match — pair devices", action: sync.approvePairing)
                    .buttonStyle(.borderedProminent).disabled(sync.busy || sync.pairingVerification.isEmpty)
                } else {
                  Text("Approve on your other device to finish. This Mac will connect automatically.")
                }
              }
              HStack {
                Text("Expires in \(seconds / 60):\(String(format: "%02d", seconds % 60))").foregroundStyle(.secondary)
                Spacer()
                Button("Cancel pairing", action: sync.cancelPairing).disabled(sync.busy)
              }
            }
          }
        } else {
          Text("Create a code here, or enter the code from your other device.")
          Button("Pair a device", action: sync.createInvitation).disabled(sync.busy)
          HStack {
            TextField("Six-character code", text: $code)
              .font(.system(.body, design: .monospaced))
              .onChange(of: code) { _, value in code = String(SyncPairing.normalize(value).prefix(6)) }
              .onSubmit { if SyncPairing.validCode(code) { sync.join(code) } }
            Button("Connect with code") { sync.join(code) }
              .disabled(!SyncPairing.validCode(code) || sync.busy)
          }
          DisclosureGroup("Pair with an older app version") {
            TextField("Paste dosync1: invitation", text: $legacyCode).onChange(of: legacyCode) { _, value in
              if value.count > 2048 { legacyCode = String(value.prefix(2048)) }
            }
            Button("Request pairing") { sync.join(legacyCode) }
              .disabled(legacyCode.isEmpty || sync.busy)
          }
        }
        Text(
          "End-to-end encrypted over the internet. Text ≤256 KiB; lossless PNG ≤8 MiB / 40 MP. Transfers expire after 2 minutes and are deleted after receipt. Sync keeps no clipboard history. iPhone/iPad browsers require explicit actions while open. Copied file references are not image bytes."
        ).font(.caption).foregroundStyle(.secondary)
      }
    }.formStyle(.grouped)
  }
}

private struct PairingQRCode: View {
  let value: String
  private var image: NSImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(value.utf8)
    filter.correctionLevel = "M"
    guard let output = filter.outputImage,
      let image = CIContext().createCGImage(output.transformed(by: CGAffineTransform(scaleX: 4, y: 4)), from: output.extent.applying(CGAffineTransform(scaleX: 4, y: 4)))
    else { return nil }
    return NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
  }
  var body: some View {
    if let image {
      Image(nsImage: image).interpolation(.none).resizable().scaledToFit()
        .frame(width: 192, height: 192).padding(20).background(.white).clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel("QR code to pair with this Mac")
    } else { Text("Use the six-character code below to connect.") }
  }
}
