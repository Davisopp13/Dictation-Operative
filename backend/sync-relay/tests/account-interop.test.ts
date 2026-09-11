import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  seal,
  open,
  randomSecret,
  type Account,
  type AISettings,
} from "../../../Shared/Sync/account";
test(
  "Web Crypto and native CryptoKit exchange encrypted Groq settings in both directions",
  { skip: process.platform !== "darwin" },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "do-account-interop-")),
      binary = join(folder, "interop");
    try {
      const compile = spawnSync(
        "swiftc",
        [
          "-parse-as-library",
          "../../macos/Dictation/Sync/SyncProtocol.swift",
          "../../macos/Dictation/Sync/SyncTransport.swift",
          "../../macos/Dictation/Sync/AccountProtocol.swift",
          "tests/account-interop.swift",
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );
      assert.equal(compile.status, 0, compile.stderr);
      const account: Account = {
        v: 1,
        id: "a".repeat(64),
        label: "Synthetic test account",
        secret: randomSecret(),
        token: randomSecret(),
        device: { id: "test-device-1", name: "Mac" },
      };
      const settings: AISettings = {
        v: 1,
        provider: "groq",
        model: "test-model",
        cleanupEnabled: true,
        vocabulary: ["Hapag-Lloyd", "日本語"],
        groqKey: "gsk_synthetic_test_key_12345",
      };
      const envelope = await seal(
        account,
        "settings",
        1,
        new TextEncoder().encode(JSON.stringify(settings)),
      );
      const native = spawnSync(binary, [], {
        input: JSON.stringify({ account, envelope, settings }),
        encoding: "utf8",
      });
      assert.equal(native.status, 0, native.stderr);
      const received = JSON.parse(
        new TextDecoder().decode(await open(account, JSON.parse(native.stdout), "settings")),
      );
      assert.deepEqual(received, settings);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
