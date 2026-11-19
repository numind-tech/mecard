// Publishable examples and screenshots, all generated in the ignored dist/.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values } = parseArgs({ options: {
  url: { type: "string", default: "https://numind-tech.github.io/mecard/" },
} });
const out = resolve("dist/demo");
const base = new URL(values.url.replace(/\/?$/, "/"));
assert.ok(["https:", "http:"].includes(base.protocol), "Use an HTTP(S) demo URL");
await mkdir(resolve(out, "previews"), { recursive: true });
execFileSync(process.execPath, ["build.js", "--config", "examples/demo.yaml",
  "--out", resolve(out, "card"), "--url", new URL("card/", base).href, "--strict"],
{ stdio: "inherit" });
await cp("examples/demo", out, { recursive: true });

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    // Match static hosts that redirect index.html to its directory URL.
    if (path.endsWith("/index.html")) {
      res.writeHead(308, { Location: path.slice(0, -"index.html".length) }).end();
      return;
    }
    const file = resolve(out, `.${path}${path.endsWith("/") ? "index.html" : ""}`);
    if (!file.startsWith(out + sep)) throw new Error("Outside the demo");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  let gallery = await readFile(resolve(out, "index.html"), "utf8");
  for (const layout of ["portrait", "landscape"]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2,
        locale: "en", colorScheme: "light", reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/card/`);
      if (theme === "dark") {
        await page.locator(".theme-toggle").click();
        await page.locator('[data-language="fr"]').click();
      }
      if (layout === "landscape") {
        await page.locator(".layout-toggle").click();
        await page.locator('.contact-qr [data-qr-mode="link"]').click();
      }
      assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
      assert.equal(await page.locator("html").getAttribute("data-layout"), layout);
      assert.equal(await page.locator("html").getAttribute("lang"), theme === "dark" ? "fr" : "en");
      await page.evaluate(() => document.fonts.ready);
      // Move the pointer off the controls, then capture the card and its shadow.
      await page.mouse.move(0, 0);
      await page.locator(".card").screenshot({ animations: "disabled" });
      const box = await page.locator(".card").boundingBox();
      const clip = { x: box.x - 20, y: box.y - 20,
        width: box.width + 40, height: box.height + 40 };
      const file = `${layout}-${theme}.png`;
      await page.screenshot({ path: resolve(out, "previews", file), clip, animations: "disabled" });
      gallery = gallery.replace(new RegExp(`(src="previews/${file}"[^>]*?)width="\\d+" height="\\d+"`),
        `$1width="${Math.ceil(clip.width)}" height="${Math.ceil(clip.height)}"`);
      assert.deepEqual(errors, [], "The demo should have no browser errors");
      await context.close();
      console.log(`Captured ${file}`);
    }
  }
  await writeFile(resolve(out, "index.html"), gallery);

  // Confirm that the installable example really reopens without a network.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/card/`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null,
    null, { timeout: 15_000 });
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator(".name").innerText(), "Alex Morgan");
  await context.close();
  console.log("Verified offline reopening. Demo ready in dist/demo/");
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
