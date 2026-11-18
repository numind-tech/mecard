# mecard

Generate digital business cards from YAML. Each card has one HTML page
for all its languages, a portrait favicon, and optional PWA files.
Run the generator locally or in CI, then publish the output on a static
host. Card data and branding can live in a separate private repository.

- Any number of languages, selected from browser preferences or manually.
- Paper and illustrated layouts that adapt to portrait and landscape.
- Light and dark themes, including separate brand logo variants.
- Contact downloads, native sharing, and one QR for a contact or its URL.
- One card or a whole site, with shared defaults and a URL per person.
- Portrait favicons, optional offline support, and no indexing by default.

Photos, logos, QR codes, translations and contact data are embedded in
the HTML. Switching language, appearance or QR mode does not reload the
page or fetch assets from another site.

## Setup

Use **Node.js 22 or later** and npm, or the [container image](#container-image).
From the generator checkout, install the locked dependencies:

```bash
npm ci
```

Create or edit `config.yaml` with the required `name` and `url`, then add contact details, a portrait and an optional logo. Asset paths are relative to the config file.

Set `url` to the card's hosting address. URL QR mode and native sharing
use that destination. The default build includes PWA files; set
`options.pwa: false` for just `index.html` and `favicon.png`.

```bash
npm run dev               # live preview at http://127.0.0.1:3000
npm run build -- --strict  # validate and generate dist/
npm test                  # check the output using synthetic test data
```

Both `dev` and `build` take `--config <file>` and `--out <dir>`, so one checkout can produce several cards. Paths inside a config, such as `photo`, are relative to that config file.

### Several cards on one domain

Keep each person's YAML in `cards/`, shared branding in `cards/shared.yaml`, and the site settings in `site.yaml`. These paths are gitignored so personal data can live in a separate private repository.

The site settings contain a domain `url`, an optional root `redirect`, an optional `defaults` YAML path, and a `cards` mapping from URL slugs to individual YAML paths. All file paths are relative to `site.yaml`. A card mapped as `person: cards/person.yaml` is generated at `/person/`, with its public URL derived from the site domain. Slugs use lowercase letters, digits and single hyphens between segments; individual card files do not need their own `url`.

```bash
npm run build:site -- --strict
# Or keep all data in another checkout:
npm run build:site -- \
  --config /path/to/private-cards/site.yaml --out dist/site --strict
```

Publish the complete `dist/site/` directory. It contains each card's
HTML, favicon and optional PWA assets, a 404 page, and hosting rules.
Rebuilding replaces the site only after every card succeeds and removes
cards no longer listed. A sibling `dist/site.mecard.json` records output
ownership; keep it locally and do not upload it. Existing directories
without this marker are preserved: choose a new output path for the first
build.

Shared mappings (theme, options, translations and labels) merge with each person's settings. Lists, such as links, are replaced by the person's list; explicit `null` clears a shared value. Asset paths are resolved relative to the YAML file declaring them. Remote portrait URLs are downloaded and embedded at build time, so no portrait file needs to be committed.

For a single-card preview using the same shared theme:

```bash
npm run dev -- \
  --config /path/to/private-cards/cards/person.yaml \
  --defaults /path/to/private-cards/cards/shared.yaml \
  --url https://cards.example.org/person/
```

The build checks the config as it reads it and prints a warning for anything it has to work around: a misspelt key (with a suggestion), a colour that isn't a hex value, a link without a `url`, an unknown icon. Add `--strict` to make warnings fail the build.

The preview server listens only on your computer's IPv4 loopback interface.

### Container image

The image packages the generator, its dependencies and fonts. It provides
a shell and two commands: `mecard` for one card and `mecard-site` for a
site. Use it locally with Docker or Podman, or in a CI job that supplies
the data checkout and collects the output.

Build it from this repository:

```sh
docker build -t mecard:local .
```

Then, from a separate data checkout containing `site.yaml`:

```sh
mkdir -p dist
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/data:ro" -v "$PWD/dist:/output" -w /data \
  mecard:local mecard-site --config site.yaml --out /output/site --strict
```

The generated site is now in that checkout's `dist/site/`. Mount the
parent output directory so the generator can replace the site atomically.
The image's build context includes only the generic generator files.

The [container guide](docs/container-ci.md) covers interactive shells,
Podman/SELinux mounts, image versions and registry publication. The
GitHub workflow builds AMD64 and ARM64 images for GHCR. Use a versioned
tag or image digest in CI.

## Publishing

Serve the complete generated directory on a static host, such as GitHub
Pages, Cloudflare Pages or your own web server. Set the card or site URL
to its public address. Domain routing and HTTPS are configured at the host.

Site builds produce `_redirects` for an optional root redirect and
`_headers` for indexing preferences. Cloudflare Pages understands these
files directly; configure equivalent rules when using another host.

The [GitLab CI example](examples/gitlab-ci.yml) is an optional integration:
one job generates the site and saves it as an artifact; another publishes
that artifact to Cloudflare. The [setup guide](docs/container-ci.md)
explains image selection and protected deployment variables. The same
generator commands can be used with other CI and hosting services.

The public repository's workflows test the generator and publish its
image. Personal card data and site deployment credentials belong to the
data repository and its deployment environment.

## Configuration

### Content

| Key | |
|---|---|
| `name` | Required |
| `title` | Role or job title |
| `tagline` | Short introduction, also included as a note in the contact |
| `organization` | Displayed on the card and alongside the name in its page title |
| `department` | Joined to `organization` with a `·` |
| `lang` | Fallback language when browser preferences do not match. Defaults to the first entry in `translations`, or `en` without translations |
| `dir` | Text direction: `ltr` by default, or `rtl`; can also be set per translation |
| `email` | Shown as text, tap to send |
| `phone` | Shown as text, tap to call |
| `website` | Shown as text, opens in a new tab |
| `photo` | Local or HTTP(S) JPEG, PNG, GIF or WebP, embedded at build time. Omit to show initials |
| `logo` | Optional SVG file or inline SVG, sanitized like custom icons |
| `logoDark` | Optional SVG variant for dark backgrounds, used alongside `logo` when dark mode is enabled |
| `url` | Required for a single card; derived by site builds. Destination for URL QR mode and sharing |

Any of `email`, `phone`, `website`, and `photo` can be left out.

Web addresses must use HTTP or HTTPS, without embedded credentials or control characters. Link buttons also accept `mailto:` and `tel:`. Unsafe URLs stop the build.

Remote photos must resolve only to public IP addresses, including after redirects. Downloads are limited to 5 MiB, three redirects and 15 seconds overall; HTTPS cannot redirect to HTTP. Compressed HTTP responses are refused. A blocked or failed download uses initials instead (or fails with `--strict`). For a photo on a local or private service, download it yourself and use a local file path.

Contact apps file the name by its last word. For compound names, specify `nameParts` with the keys `given`, `middle`, `family`, `prefix` and `suffix` as needed.

### Languages

Add as many language tags as you need under `translations`. Each entry can define `title`, `tagline`, `department`, `labels` and `dir`. All languages, including the initial one, use the same structure. Shared identity, contact details, links, logo, portrait and layout stay at the top level. Top-level editorial text remains a fallback for omitted translations; an empty string hides that text in a particular language.

`npm run build` writes a single multilingual `dist/index.html`, accompanied by `favicon.png`. Only text and photo-free contact data vary; the DOM, images, SVGs and styles are shared. The selector updates the current page, including accessibility labels, metadata and the contact download. Two languages use toggle buttons; three or more use a dropdown. Selection is remembered per page when browser storage is available, and switching still works when it is blocked or the file is opened locally.

On first visit, the page chooses a language from the browser's preferences, in priority order. Exact tags take precedence over broader language/script matches: `fr-CA` can use `fr`, and `zh-Hant-TW` can use `zh-Hant`. A remembered manual selection takes precedence; automatic choices are not saved. If none match, `lang` is the fallback, or the first configured translation if it is omitted. `--lang <tag>` changes that fallback while keeping every language in the same page.

Language tags are validated and normalized, including regional tags. Set `dir: rtl` within a translation for right-to-left text; the default is `ltr`.

Translated text reserves the space needed by every configured language at the current screen width, so switching languages does not move the rest of the card, including on mobile. Invisible, inert text handles sizing without duplicating assets or measuring the page in JavaScript. An explicitly empty translation stays blank while retaining its space.

French and English interface defaults are included. For any other language, provide translated `labels`; omitted labels fall back to English. All interface labels can be configured:

| Keys in `labels` | Purpose |
|---|---|
| `saveLabel`, `shareLabel`, `qrLabel` | Contact button, share button and QR caption |
| `showQr`, `enlargeQr`, `qrFor`, `close` | QR button, tooltip, dialog title prefix and close button |
| `qrMode`, `qrContactMode`, `qrLinkMode`, `qrContactLabel`, `qrLinkLabel` | QR selector's accessible names, captions and icon tooltips |
| `language`, `background` | Language selector and background navigation |
| `darkMode` | Accessible name of the dark mode toggle |
| `layout`, `layoutPortrait`, `layoutLandscape` | Accessible name and action tooltips of the portrait/landscape toggle |
| `email`, `phone`, `website` | Contact field labels |
| `digitalCard` | Label for the card URL in the downloaded contact |

The previous top-level text plus `translations` overrides remains supported. Caption/button labels in `options` also remain supported and take precedence over `labels`. All translations are validated before writing output, including languages that are not initially displayed. Without JavaScript, the initial language and its contact download remain available.

### Now

A short line about what you're up to, shown in a pill under your title. Set `now` to plain text, or use a mapping with required `text`, optional `until` in `YYYY-MM-DD` format, and optional `url`.

Once `until` has passed, the build leaves the line out, and a card built earlier hides it when it loads, so it retires on time even if nobody rebuilds.

### Links

Icon buttons below the contact details. Set `links` to a list of entries with `label`, `url` and `icon`.

Set a link's `placement: contact` to show it after the contact rows instead of as a button. The default is `button`. To show the main website as a labelled button, add it to `links` and set `options.showWebsite: false`; the website remains in the vCard, without duplication. Custom SVG pictograms work in both positions.

A contact row using the `linkedin` icon and a LinkedIn URL displays the profile handle (the final URL path component) beneath its small label. The original label and URL remain in the exported contact.

Available icons:

`scholar` `orcid` `arxiv` `inspire` `researchgate` `file` `github` `linkedin` `twitter` `bluesky` `mastodon` `instagram` `youtube` `globe` `mail` `phone` `calendar` `link` `contact` `download` `share`

`icon` can also be a path to an `.svg` file of your own; give it a `viewBox` and use `currentColor` so it takes the button's colour. An unknown name warns and falls back to `link`.

Custom SVGs are parsed as XML and limited to static shapes, groups, gradients, masks, clipping paths and descriptions. Scripts, event handlers, CSS, animation, external references, DTDs and unsupported markup are rejected; the built-in link icon replaces the entire icon with a warning. Internal gradient/mask references are supported. Icons are limited to 1 MiB and 64 levels of nesting.

### Layout and appearance

The default illustrated layout uses the configured backgrounds. Set
`options.paper: true` for a paper card with labelled contact rows, visible
link names and an animated footer wave.

Cards open in portrait by default. Viewports at least 640px wide but less
than 760px high use two columns. In the paper layout, the name and title
stay beside the portrait, with the save action below; the other column contains
contact details and company links. With `qrContact` or `qrToggle`
enabled, the QR sits beside the contact rows.

On screens at least 640px wide and 760px high, the button beside the
theme toggle switches between Portrait and Landscape, letting you
preview both.
Each page opens with the automatic viewport layout; clicking overrides
it until the page is reloaded. If the window becomes too small for the
toggle, the responsive layout takes over; the manual choice resumes
when there is room again. Without JavaScript, the layout remains automatic.

Short landscape screens use more compact spacing and a lower footer
wave. Controls retain their touch targets, contact hover backgrounds
leave space before the QR, and safe areas account for phone notches.
The enlarged QR also adapts to landscape. Content stays scrollable when
needed, and installed cards allow rotation.

#### Theme colours

Three colour bands run diagonally across the card, top-left to bottom-right. The `theme` mapping accepts `dark`, `mid` and `light` for those bands, `accent` for links and icons, `pop` for the Save Contact button, `page` for the page background, and `text` for foreground text. Omit `mid` to blend `dark` and `light`.

Muted text is derived from `text`. Colours use three- or six-digit hex notation and need quotes in YAML: an unquoted `#` starts a comment, so the build warns and uses the default colour instead.

#### Light and dark modes

The page follows the browser’s light/dark preference, with a moon/sun button to choose manually. The choice is remembered across cards on the same origin when browser storage is available; switching also works with storage blocked or when opening the HTML locally. Until a manual choice is made, changes to the system setting update the page automatically. The appearance is applied before the first paint, and CSS still follows the system setting without JavaScript.

Both layouts use colours derived from the configured theme, with readable foreground and button colours. With `logo` and `logoDark`, the appropriate logo is shown directly on the card background, following the system theme or manual choice. Both SVGs are sanitized and embedded; their paths resolve relative to the YAML file declaring them, including shared defaults. Without `logoDark`, the single logo retains a white backing for readability. QR codes stay dark on white in either mode. The paper footer wave keeps its brand colours. Set `options.darkMode: false` to retain the original configured appearance without a toggle. Localize its accessible name with `labels.darkMode`.

### Backgrounds

Set `backgrounds` to an ordered list of names:

| Name | |
|---|---|
| `waves` | The three diagonal bands from `theme`, with travelling boundaries. The default |
| `paul` | A Paul trap cross-section with a three-ion crystal swaying in its normal modes, lit by 493 nm and 650 nm beams |
| `spectrum` | The barium emission spectrum as a spectrograph plate, with a scan that traces it along the bottom |

In the illustrated layout, the first entry is what visitors see first. With more than one, they can swipe the card sideways, tap the dots under it, or use the arrow keys to switch. Their last choice is remembered, and a link ending in `#spectrum` (or any other name) opens that background directly. Backgrounds that aren't showing are paused, and visitors who prefer reduced motion get each one as a still frame. The paper layout uses its footer wave instead of these backgrounds.

### Options

The `options` mapping accepts these settings:

| Key | Default | Purpose |
|---|---|---|
| `indexable` | `false` | Ask search engines not to index the card; set to `true` to permit indexing |
| `paper` | `false` | Paper card with visible link labels and a footer wave; uses `dark` for buttons and `accent` for the start of the wave |
| `darkMode` | `true` | Follow the system appearance and offer a remembered light/dark toggle |
| `glint` | `false` | Light sweep across the card |
| `animateWaves` | `true` | Animate the wave boundaries, including the paper layout's footer; set to `false` for a still wave |
| `qr` | `true` | Display the QR code |
| `qrContact` | `false` | Encode the photo-free vCard in the QR; in the paper layout, place it beside the contact details |
| `qrToggle` | `false` | Switch one QR between contact and card URL with icon controls; `qrContact` chooses the initial mode |
| `showWebsite` | `true` | Show the website among contact rows; does not remove it from the exported contact |
| `saveContact` | `true` | Offer contact download |
| `share` | `true` | Offer sharing where supported |
| `pwa` | `true` | Installable card with offline support |

Use `labels` for interface text. The legacy `options.qrLabel`,
`options.saveLabel` and `options.shareLabel` aliases remain supported and
override the corresponding labels.

Animation is reduced or stopped for visitors who set `prefers-reduced-motion`.

### Indexing

Cards are not indexable by default. `options.indexable: false` adds a robots meta tag with `noindex`, `nofollow`, `noarchive`, `nosnippet` and `noimageindex`. Site builds also emit Cloudflare Pages `_headers` rules with `X-Robots-Tag`, scoped to unindexed cards when preferences differ. A single-card HTML keeps the meta tag on any static host.

Do not block search crawlers with `Disallow: /` in `robots.txt`: they need to read the page or HTTP headers to see `noindex`. These directives are requests to compliant crawlers, not authentication or a guarantee against copying. Blocking known AI crawlers can be configured separately at the hosting provider. See [Google's noindex documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

## Contact exchange

### QR modes

By default the QR code encodes the card's URL, so it stays sparse and your details can change without replacing the code. Set `options.qrContact: true` to encode the contact itself: name, role, organization, email, telephone, website and configured links, without the portrait. Compatible scanning apps can offer to import the contact without opening the website. The QR updates with the selected language. In the paper layout it sits beside the contact details, or below them on very narrow screens. Give `labels.qrLabel` an appropriate contact caption in each language.

Tap the QR preview to open a larger dark-on-white copy. Contact QR codes
are denser, so use this view if another phone has difficulty scanning the
preview. The page requests a
[screen wake lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
when supported and permitted by the browser. Contact QR codes contain
the details from the last build and must be regenerated after a change.

With `options.qrToggle: true`, one QR switches between the vCard and the card URL. Both modes are generated and embedded at build time. The selection stays synchronized with the enlarged view and survives language changes; a reload returns to the configured initial mode. The mode controls are hidden without JavaScript and the initial QR remains scannable. Translate the selector with `labels.qrMode`, `qrContactMode`, `qrLinkMode`, and its captions with `qrContactLabel` and `qrLinkLabel`. Setting `qr: false` hides the QR and selector completely.

### Download and native sharing

**Save contact** provides a vCard 3.0 `.vcf` file for contact apps. The
operating system and browser determine whether it opens an import screen
or downloads the file first. With JavaScript enabled, the save action
adds the embedded portrait; the contact QR always omits it. The tagline
becomes a note, and links are exported with their labels for apps that
support them.

The **share icon** next to the save action opens the system share sheet
for the card URL. It is shown only when the
[Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
is available, which depends on the browser and a secure context.

## Generated files

| Build | Files to publish |
|---|---|
| One card, `pwa: false` | `index.html` and `favicon.png` |
| One card, `pwa: true` (default) | The same files, plus `manifest.webmanifest`, `sw.js`, a portrait or initials icon, and maskable PNG icons |
| Site | Each card's files in its slug directory, `404.html`, and `_headers` / `_redirects` when applicable |

Single-card builds default to `dist/`; site builds default to
`dist/site/`. Keep each output directory together when copying or
publishing it. The sibling site ownership marker stays outside the
published directory.

**Favicon**: every build emits a small 64×64 PNG thumbnail of the portrait, with a top-centred crop, or initials when no photo is provided. It works independently of PWA mode. Upload `favicon.png` alongside `index.html`; the versioned icon URL changes when the image changes. Photos are decoded with a 16-megapixel limit; a decoding failure falls back to initials (or fails with `--strict`).

**PWA**: the manifest and service worker support installation and offline
reopening after the page has been loaded and cached. The installed card
uses an app window and allows rotation. The build also supplies maskable
icons for launchers. Installation depends on browser support and
[HTTPS or a local development server](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

**Metadata**: the page title includes the person's name and organization
when supplied. The HTML also includes Open Graph fields and schema.org
`Person` data with profile links listed as `sameAs`. This metadata does
not override the default indexing restrictions.

## Development

`build.js` assembles one card; `build-site.js` builds a collection from
separate data. Layout lives in `card.css`, `paper.css` and `landscape.css`.
Page behavior lives in `card.js`, `language.js`, `qr-switch.js`,
`appearance.js` and `layout.js`,
all embedded in the generated HTML. `appearance.css` and
`appearance-theme.js` provide the palettes; `locales.js`, `backgrounds.js`
and `icons.js` supply interface text and artwork. `favicon.js` creates
the portrait thumbnail. `npm run dev` rebuilds on source or data changes.

```sh
npm test
scripts/test-container.sh mecard:local
```

Tests use synthetic data. The container smoke test checks generation
from a read-only data mount, relative theme assets, both commands and
files exported to the host. It requires the locally built image and
Docker, or `CONTAINER_ENGINE=podman`.

## License

MIT
