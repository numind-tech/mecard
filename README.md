# mecard

Generate digital business cards from YAML. Each card has one HTML page
for all its languages and optional PWA files.
Run the generator locally or in CI, then publish the output on a static
host. Card data and branding can live in a separate private repository.

- Any number of languages, selected from browser preferences or manually.
- Paper and illustrated layouts.
- Light and dark themes, including separate brand logo variants.
- Contact downloads, native sharing, and contact QR codes.
- One card or a whole site, with shared defaults and a URL per person.

Photos, logos, QR codes, translations and contact data are embedded in
the HTML. Switching language or appearance does not reload the
page or fetch assets from another site.

## Setup

Use **Node.js 22 or later** and npm.
From the generator checkout, install the locked dependencies:

```bash
npm ci
```

Create or edit `config.yaml` with the required `name` and `url`, then add contact details, a portrait and an optional logo. Asset paths are relative to the config file.

Set `url` to the card's hosting address. URL QR mode and native sharing
use that destination. The default build includes PWA files; set
`options.pwa: false` for just `index.html`.

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
HTML and optional PWA assets, a 404 page, and hosting rules.
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

## Publishing

Serve the complete generated directory on a static host, such as GitHub
Pages, Cloudflare Pages or your own web server. Set the card or site URL
to its public address. Domain routing and HTTPS are configured at the host.

Site builds produce `_redirects` for an optional root redirect and
`_headers` for indexing preferences. Cloudflare Pages understands these
files directly; configure equivalent rules when using another host.

The public repository's workflow tests the generator with synthetic
data. Card data and deployment credentials belong to a separate data
repository and its deployment environment.

## Configuration

### Content

| Key | |
|---|---|
| `name` | Required |
| `title` | Role or job title |
| `tagline` | Short introduction, also included as a note in the contact |
| `organization` | |
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

`npm run build` writes a single `dist/index.html`. Only text and photo-free contact data vary; the DOM, images, SVGs and styles are shared. The selector updates the current page, including accessibility labels, metadata and the contact download. Two languages use toggle buttons; three or more use a dropdown. Selection is remembered per page when browser storage is available, and switching still works when it is blocked or the file is opened locally.

On first visit, the page chooses a language from the browser's preferences, in priority order. Exact tags take precedence over broader language/script matches: `fr-CA` can use `fr`, and `zh-Hant-TW` can use `zh-Hant`. A remembered manual selection takes precedence; automatic choices are not saved. If none match, `lang` is the fallback, or the first configured translation if it is omitted. `--lang <tag>` changes that fallback while keeping every language in the same page.

Language tags are validated and normalized, including regional tags. Set `dir: rtl` within a translation for right-to-left text; the default is `ltr`.

French and English interface defaults are included. For any other language, provide translated `labels`; omitted labels fall back to English. All interface labels can be configured:

| Keys in `labels` | Purpose |
|---|---|
| `saveLabel`, `shareLabel`, `qrLabel` | Contact button, share button and QR caption |
| `showQr`, `enlargeQr`, `qrFor`, `close` | QR button, tooltip, dialog title prefix and close button |
| `language`, `background` | Language selector and background navigation |
| `darkMode` | Accessible name of the dark mode toggle |
| `email`, `phone`, `website` | Contact field labels |
| `digitalCard` | Label for the card URL in the downloaded contact |

The previous top-level text plus `translations` overrides remains supported. Caption/button labels in `options` also remain supported and take precedence over `labels`. All translations are validated before writing output, including languages that are not initially displayed. Without JavaScript, the initial language and its contact download remain available.

### Now

A short line about what you're up to, shown in a pill under your title. Set `now` to plain text, or use a mapping with required `text`, optional `until` in `YYYY-MM-DD` format, and optional `url`.

Once `until` has passed, the build leaves the line out, and a card built earlier hides it when it loads, so it retires on time even if nobody rebuilds.

### Links

Icon buttons below the contact details. Set `links` to a list of entries with `label`, `url` and `icon`.

Available icons:

`scholar` `orcid` `arxiv` `inspire` `researchgate` `file` `github` `linkedin` `twitter` `bluesky` `mastodon` `instagram` `youtube` `globe` `mail` `phone` `calendar` `link` `download` `share`

`icon` can also be a path to an `.svg` file of your own; give it a `viewBox` and use `currentColor` so it takes the button's colour. An unknown name warns and falls back to `link`.

Custom SVGs are parsed as XML and limited to static shapes, groups, gradients, masks, clipping paths and descriptions. Scripts, event handlers, CSS, animation, external references, DTDs and unsupported markup are rejected; the built-in link icon replaces the entire icon with a warning. Internal gradient/mask references are supported. Icons are limited to 1 MiB and 64 levels of nesting.

### Layout and appearance

The default illustrated layout uses the configured backgrounds. Set
`options.paper: true` for a paper card with labelled contact rows, visible
link names and an animated footer wave.

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

### Download and native sharing

**Save contact** provides a vCard 3.0 `.vcf` file for contact apps. The
operating system and browser determine whether it opens an import screen
or downloads the file first. With JavaScript enabled, the save action
adds the embedded portrait; the contact QR always omits it. The tagline
becomes a note, and links are exported with their labels for apps that
support them.

The **Share** button opens the system share sheet for the card URL. It is shown only when the
[Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
is available, which depends on the browser and a secure context.

## Generated files

| Build | Files to publish |
|---|---|
| One card, `pwa: false` | `index.html` |
| One card, `pwa: true` (default) | The same files, plus `manifest.webmanifest`, `sw.js`, a portrait or initials icon, and maskable PNG icons |
| Site | Each card's files in its slug directory, `404.html`, and `_headers` / `_redirects` when applicable |

Single-card builds default to `dist/`; site builds default to
`dist/site/`. Keep each output directory together when copying or
publishing it. The sibling site ownership marker stays outside the
published directory.

**PWA**: the manifest and service worker support installation and offline
reopening after the page has been loaded and cached. The installed card
uses an app window. The build also supplies maskable
icons for launchers. Installation depends on browser support and
[HTTPS or a local development server](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

**Metadata**: the HTML includes Open Graph fields and schema.org
`Person` data with profile links listed as `sameAs`. This metadata does
not override the default indexing restrictions.

## Development

`build.js` assembles one card; `build-site.js` builds a collection from
separate data. Layout lives in `card.css` and `paper.css`. Page behavior
lives in `card.js`, `language.js`, `appearance.js`,
all embedded in the generated HTML. `appearance.css` and
`appearance-theme.js` provide the palettes; `locales.js`, `backgrounds.js`
and `icons.js` supply interface text and artwork. `npm run dev` rebuilds on source or data changes.

## License

MIT
