import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  SyncClient,
  DEFAULT_RELAY,
  base64,
  credentials,
  url64,
  sha256,
  type Pair,
} from "../../../Shared/Sync/protocol";
import { readFile } from "node:fs/promises";
const native = (input: unknown) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn("/tmp/do-sync-native-validation", [], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "",
      error = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (error += d));
    child.on("close", (code, signal) =>
      code === 0
        ? resolve(JSON.parse(output))
        : reject(new Error(`Native process exit ${code}, signal ${signal}: ${error}`)),
    );
    child.stdin.end(JSON.stringify(input));
  });
const p: Pair = {
  relay: DEFAULT_RELAY,
  secret: url64(crypto.getRandomValues(new Uint8Array(32))),
  auth: url64(crypto.getRandomValues(new Uint8Array(32))),
  guestAuth: url64(crypto.getRandomValues(new Uint8Array(32))),
  role: "host",
  device: { id: crypto.randomUUID(), name: "Protocol validation" },
  peerName: "Native validation",
};
const q: Pair = {
  ...p,
  auth: p.guestAuth!,
  role: "guest",
  device: { id: crypto.randomUUID(), name: "Native validation" },
};
const host = new SyncClient(p);
await host.create();
try {
  const js = await credentials(q),
    swift = await native({ pair: q, operation: "derive" });
  assert.equal(swift.room, js.room);
  assert.equal(swift.token, js.token);
  await native({ pair: q, operation: "join" });
  await host.approve(q.device.id);
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const payload = {
      mime: "text/plain" as const,
      bytes: new TextEncoder().encode("Synthetic Sync validation café 🎙️ " + i),
    };
    const start = performance.now();
    await host.send(payload);
    const result = await native({ pair: q, operation: "receive" });
    samples.push(Math.round(performance.now() - start));
    assert.equal(result.digest, await sha256(payload.bytes));
    assert.equal(result.loopExcluded, true);
    assert.equal(result.staleOverwriteBlocked, true);
  }
  const png = new Uint8Array(
    await readFile(new URL("../../../macos/SyncValidation/transparency.png", import.meta.url)),
  );
  await host.send({ mime: "image/png", bytes: png });
  const received = await native({ pair: q, operation: "receive" });
  assert.equal(received.digest, await sha256(png));
  assert.equal(received.alpha, true);
  assert.equal(received.width, 64);
  assert.equal(received.height, 32);
  await native({ pair: q, operation: "send", mime: "image/png", bytes: base64(png) });
  const incoming = (await host.state()).latest!;
  assert.deepEqual((await host.receive(incoming)).bytes, png);
  await host.ack(incoming.id);
  await native({
    pair: q,
    operation: "send",
    mime: "text/plain",
    bytes: base64(new TextEncoder().encode("Native to web")),
  });
  const text = (await host.state()).latest!;
  assert.equal(new TextDecoder().decode((await host.receive(text)).bytes), "Native to web");
  await host.ack(text.id);
  console.log(
    JSON.stringify(
      { passed: true, textRelayToNativeClipboardMs: samples, image: received },
      null,
      2,
    ),
  );
} finally {
  await host.revoke();
}
