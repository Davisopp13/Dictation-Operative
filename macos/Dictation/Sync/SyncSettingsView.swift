import AppKit
import SwiftUI

struct SyncSettingsView: View {
  @Environment(SyncService.self) private var sync
  @State private var code = ""
  var body: some View {
    @Bindable var sync = sync
    Form {
      Section("This device") {
        HStack {
          TextField("Name", text: $sync.config.device.name).onChange(of: sync.config.device.name) {
            _, value in if value.count > 60 { sync.config.device.name = String(value.prefix(60)) }
          }
          Button("Save", action: sync.rename).disabled(sync.busy)
        }
        Toggle("Pause Sync", isOn: $sync.config.paused).onChange(of: sync.config.paused) { _, _ in
          sync.persist(reset: true)
        }.disabled(sync.busy)
        Text(sync.status).font(.caption).textSelection(.enabled)
        if let error = sync.error { Text(error).font(.caption).foregroundStyle(.red) }
        if sync.busy { ProgressView(value: sync.progress) }
      }
      Section("Trusted devices") {
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
        if sync.pair?.role == "host", sync.state?.approved == false, let guest = sync.state?.guest {
          Button("Trust and pair “\(guest.name)”", action: sync.approve).disabled(sync.busy)
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
        Button("Create private invitation", action: sync.createInvitation).disabled(sync.busy)
        if !sync.invitation.isEmpty {
          Text("Expires in 5 minutes. Share only with your other device.").font(.caption)
          Text(sync.invitation).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
            .lineLimit(3)
          Button("Copy invitation") {
            let item = NSPasteboardItem()
            item.setString(sync.invitation, forType: .string)
            item.setData(Data(), forType: .init("org.nspasteboard.ConcealedType"))
            NSPasteboard.general.clearContents()
            NSPasteboard.general.writeObjects([item])
          }
        }
        TextField("Paste dosync1: invitation", text: $code).onChange(of: code) { _, value in
          if value.count > 2048 { code = String(value.prefix(2048)) }
        }
        Button("Request pairing") {
          sync.join(code)
          code = ""
        }.disabled(code.isEmpty || sync.busy)
        Text(
          "End-to-end encrypted over the internet. Text ≤256 KiB; lossless PNG ≤8 MiB / 40 MP. Transfers expire after 2 minutes and are deleted after receipt. Sync keeps no clipboard history. iPhone/iPad browsers require explicit actions while open. Copied file references are not image bytes."
        ).font(.caption).foregroundStyle(.secondary)
      }
    }.formStyle(.grouped)
  }
}
