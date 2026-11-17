import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "node:net";

test("preview binds to IPv4 loopback and serves the generated card", { timeout: 60000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mecard-dev-"));
  const file = join(dir, "config.yaml");
  writeFileSync(file, "name: Preview\nurl: https://example.org/card\noptions:\n  pwa: false\n");
  const child = spawn(process.execPath, [resolve(import.meta.dirname, "../dev.js"), "--config", file, "--out", join(dir, "dist")], {
    env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const address = await new Promise((resolveReady, reject) => {
    let stdout = "", stderr = "";
    const timer = setTimeout(() => reject(new Error(`preview did not start: ${stdout}\n${stderr}`)), 45000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`preview exited (${code}): ${stderr}`)); });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = /http:\/\/([^\s]+)\s+\(watching for changes\)/.exec(stdout);
      if (match && stdout.includes("✓ Built")) {
        clearTimeout(timer);
        resolveReady(new URL(`http://${match[1]}`));
      }
    });
  });
  // The startup message reports server.address(), not a hard-coded host.
  assert.equal(address.hostname, "127.0.0.1");
  const response = await fetch(address, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Preview<\/title>/);

  const lan = Object.values(networkInterfaces()).flat().find((entry) => entry.family === "IPv4" && !entry.internal);
  if (lan) {
    await new Promise((resolveClosed, reject) => {
      const socket = connect({ host: lan.address, port: Number(address.port) });
      socket.setTimeout(2000, () => { socket.destroy(); resolveClosed(); });
      socket.on("error", resolveClosed);
      socket.on("connect", () => { socket.destroy(); reject(new Error("preview is exposed on a non-loopback interface")); });
    });
  }
});
