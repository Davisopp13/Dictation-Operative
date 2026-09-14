import SwiftUI

struct AccountSettingsView: View {
  @Environment(SyncService.self) private var sync
  @State private var includeKey = false
  var body: some View {
    @Bindable var account = sync.accountSync
    Section("Account & shared Groq connection") {
      if let current = account.config.account {
        Text("Connected as \(current.device.name)").font(.headline)
        if let pair = sync.pair {
          Button("Add selected paired device to account") { account.invite(pair) }.disabled(account.busy || sync.busy)
        }
        ForEach(account.state?.devices ?? []) { device in
          HStack {
            Text(device.name + (device.id == current.device.id ? " (this Mac)" : ""))
            Text(Date().timeIntervalSince1970 * 1000 - Double(device.seen) < 15000 ? "Online" : "Offline").foregroundStyle(.secondary)
            Spacer()
            Button("Remove", role: .destructive) { account.remove(device.id) }.disabled(account.busy)
          }
        }
        Toggle("Follow shared Groq preferences", isOn: $account.config.followSettings).onChange(of: account.config.followSettings) { _, _ in account.saveOptions() }
        Toggle("Also apply the shared Groq API key", isOn: $account.config.applyKey).onChange(of: account.config.applyKey) { _, _ in account.saveOptions() }
        Button("Apply shared settings now", action: account.applyNow).disabled(account.busy || account.state?.settings == nil)
        Text("Applying shared settings selects Groq, its model, cleanup preference and dictionary. Your local API key is preserved unless you enable applying the shared key. Other providers remain local.").font(.caption).foregroundStyle(.secondary)
        Toggle("Include this Mac’s Groq API key when publishing", isOn: $includeKey)
        Button("Publish this Mac’s Groq settings") { account.publish(includeKey: includeKey) }.disabled(account.busy || account.state == nil)
        Toggle("Automatically share account clipboards", isOn: $account.config.automaticClipboard).onChange(of: account.config.automaticClipboard) { _, enabled in
          if enabled { sync.config.automatic = false; sync.persist() }
          account.saveOptions()
        }
        Button("Share clipboard with account", action: account.sendClipboard).disabled(account.busy || account.state == nil)
        ForEach(account.state?.clipboards ?? []) { item in
          HStack {
            Text(account.state?.devices.first { $0.id == item.sender }?.name ?? "Device")
            Text(Date(timeIntervalSince1970: Double(item.createdAt) / 1000), style: .time).foregroundStyle(.secondary)
            Spacer()
            Button("Copy to this Mac") { account.receive(item) }.disabled(account.busy || Double(item.expiresAt) / 1000 <= Date().timeIntervalSince1970)
          }
        }
        Text("Clipboard items expire after 2 minutes. Shared settings persist until replaced. Removing a device stops future access; rotate any Groq key it already received. Existing direct pairings must be removed separately.").font(.caption).foregroundStyle(.secondary)
        Button("Forget account on this Mac", role: .destructive, action: account.forgetLocally).disabled(account.busy)
      } else {
        Link("Open DO and sign in", destination: URL(string: "https://do-voice-workspace.davisopp.workers.dev/")!)
        Text("Set up account sync in the web app, pair this Mac, and choose Add paired device to account. Then receive the invitation here.").font(.caption)
        Button("Receive account invitation") { if let pair = sync.pair { account.connect(pair) } }.disabled(sync.pair == nil || sync.busy || account.busy)
      }
      Text(account.message).font(.caption)
      if let error = account.error { Text(error).foregroundStyle(.red).font(.caption) }
    }.disabled(sync.config.paused || account.busy)
  }
}
