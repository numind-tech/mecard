#!/bin/sh
# Integration test using synthetic data outside the generator checkout.
# Usage: scripts/test-container.sh mecard:test
#        CONTAINER_ENGINE=podman scripts/test-container.sh mecard:test
set -eu
engine=${CONTAINER_ENGINE:-docker}
image=${1:-mecard:test}
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
mkdir -p "$fixture/data/cards" "$fixture/data/theme" "$fixture/output"

cat > "$fixture/data/site.yaml" <<'YAML'
url: https://cards.example.test
redirect: https://example.test/about
defaults: theme/shared.yaml
cards:
  first: cards/first.yaml
  second: cards/second.yaml
YAML
cat > "$fixture/data/theme/shared.yaml" <<'YAML'
organization: Example Organization
logo: logo.svg
photo: portrait.jpg
options:
  paper: true
  pwa: false
  qrContact: true
  qrToggle: true
translations:
  en:
    title: Director
  fr:
    title: Direction
YAML
cat > "$fixture/data/theme/logo.svg" <<'SVG'
<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#123abc"/></svg>
SVG
# Synthetic 2x2 JPEG. Exercises the native photo decoder without a download.
base64 -d > "$fixture/data/theme/portrait.jpg" <<'BASE64'
/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIABgA//2Q==
BASE64
cat > "$fixture/data/cards/first.yaml" <<'YAML'
name: Example One
email: one@example.test
YAML
cat > "$fixture/data/cards/second.yaml" <<'YAML'
name: Example Two
email: two@example.test
photo: null
YAML

set -- --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev \
  --user "$(id -u):$(id -g)" \
  -v "$fixture/data:/data:ro,Z" -v "$fixture/output:/output:Z" -w /data
if [ "$engine" = podman ]; then set -- "$@" --userns=keep-id; fi
"$engine" run "$@" "$image" sh -ec '
  test ! -e /opt/mecard/site.yaml
  test ! -d /opt/mecard/cards
  test ! -d /opt/mecard/.git
  mecard-site --config site.yaml --out /output/site --strict
  mecard --config cards/first.yaml --defaults theme/shared.yaml \
    --url https://cards.example.test/first --out /output/single --strict
  node --input-type=module -e '\''
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    for (const dir of ["site/first", "site/second", "single"]) {
      const html = readFileSync(`/output/${dir}/index.html`, "utf8");
      assert.match(html, /data-language="en"/);
      assert.match(html, /data-language="fr"/);
      assert.match(html, /#123abc/);
      const png = readFileSync(`/output/${dir}/favicon.png`);
      assert.equal(png.readUInt32BE(0), 0x89504e47);
      assert.equal(png.readUInt32BE(16), 64);
      assert.equal(png.readUInt32BE(20), 64);
    }
    assert.match(readFileSync("/output/site/_headers", "utf8"), /noindex/);
    assert.match(readFileSync("/output/site/_redirects", "utf8"), /https:\/\/example.test\/about/);
    assert.ok(readFileSync("/output/site/404.html").length);
  '\''
'
test -s "$fixture/output/site/first/index.html"
test -s "$fixture/output/site/second/favicon.png"
printf '%s\n' 'Container smoke test passed: read-only data, relative theme assets, bilingual cards and host artifacts.'
