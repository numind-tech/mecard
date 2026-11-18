#!/usr/bin/env node
// Build an entire directory of cards; input files can live in another checkout.
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs, promisify } from "node:util";
import { parse } from "yaml";
import { validateUrl } from "./urls.js";
import { loadConfig, NO_INDEX } from "./config.js";

const run = promisify(execFile);
const inside = (dir, file) => file === dir || file.startsWith(dir + sep);
const mapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
let stage;
try {
  const { values: args } = parseArgs({ options: {
    config: { type: "string", short: "c", default: "site.yaml" },
    out: { type: "string", short: "o", default: "dist/site" },
    strict: { type: "boolean", default: false },
  } });
  const file = realpathSync(resolve(args.config));
  const base = dirname(file);
  const site = parse(readFileSync(file, "utf8"));
  if (!mapping(site)) throw new Error("site config must be a mapping");
  for (const key of Object.keys(site)) if (!["url", "redirect", "defaults", "cards"].includes(key)) throw new Error(`unknown site key: ${key}`);
  const origin = new URL(validateUrl(site.url, "site.url"));
  if (origin.pathname !== "/" || origin.search || origin.hash) throw new Error("site.url must be a domain URL without a path, query or fragment");
  const redirect = site.redirect == null ? null : new URL(validateUrl(site.redirect, "site.redirect")).href;
  if (site.defaults != null && typeof site.defaults !== "string") throw new Error("site.defaults must be a YAML file path");
  const defaults = site.defaults == null ? null : realpathSync(resolve(base, site.defaults));
  if (!mapping(site.cards) || !Object.keys(site.cards).length) throw new Error("site.cards must map at least one URL slug to a YAML file");
  const cards = Object.entries(site.cards).map(([slug, source]) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`invalid card slug: ${slug}`);
    if (typeof source !== "string" || !source) throw new Error(`cards.${slug} must be a YAML file path`);
    const card = { slug, source: realpathSync(resolve(base, source)), url: new URL(slug, origin).href };
    card.indexable = loadConfig(card.source, () => {}, undefined, { defaults, url: card.url }).options.indexable;
    return card;
  });

  // The output is replaced only after every card succeeds. A sibling marker
  // makes ownership explicit, and stays outside the directory being deployed.
  const requested = resolve(args.out);
  mkdirSync(dirname(requested), { recursive: true });
  const out = join(realpathSync(dirname(requested)), requested.slice(dirname(requested).length + 1));
  if ([file, defaults, ...cards.map(c => c.source), import.meta.dirname].filter(Boolean).some(source => inside(out, source))) {
    throw new Error("output directory must not contain source files");
  }
  const marker = `${out}.mecard.json`;
  if (existsSync(out)) {
    if (lstatSync(out).isSymbolicLink() || !lstatSync(out).isDirectory()) throw new Error("output must be a real directory");
    let owner;
    try { owner = JSON.parse(readFileSync(marker, "utf8")); } catch {}
    if (owner?.generator !== "mecard-site" || owner?.output !== out) throw new Error(`refusing to replace unmanaged output: ${out}; choose a new output path`);
  }
  stage = mkdtempSync(`${out}.build-`);
  for (const card of cards) {
    const flags = [join(import.meta.dirname, "build.js"), "--config", card.source, "--out", join(stage, card.slug), "--url", card.url];
    if (defaults) flags.push("--defaults", defaults);
    if (args.strict) flags.push("--strict");
    const result = await run(process.execPath, flags, { maxBuffer: 1024 * 1024 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  if (redirect) writeFileSync(join(stage, "_redirects"), `/ ${redirect} 302\n`);
  const unindexed = cards.filter(card => !card.indexable);
  if (unindexed.length) {
    const paths = unindexed.length === cards.length ? ["/*"] : unindexed.flatMap(card => [`/${card.slug}`, `/${card.slug}/*`]);
    writeFileSync(join(stage, "_headers"), paths.map(path => `${path}\n  X-Robots-Tag: ${NO_INDEX}\n`).join("\n"));
  }
  // An explicit 404 prevents static hosts from treating missing cards as SPA routes.
  writeFileSync(join(stage, "404.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>404</title><h1>404</h1><p>Page not found.</p></html>\n');
  const previous = `${stage}.previous`;
  if (existsSync(out)) renameSync(out, previous);
  try { renameSync(stage, out); } catch (error) {
    if (existsSync(previous)) renameSync(previous, out);
    throw error;
  }
  stage = null;
  writeFileSync(marker, JSON.stringify({ generator: "mecard-site", output: out }) + "\n");
  if (existsSync(previous)) rmSync(previous, { recursive: true });
  console.log(`✓ Built ${cards.length} cards in ${out}`);
} catch (error) {
  if (stage) rmSync(stage, { recursive: true, force: true });
  console.error(error.stderr || error.message);
  process.exitCode = 1;
}
