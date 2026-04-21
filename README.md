# @percy/maestro

[![npm version](https://img.shields.io/npm/v/@percy/maestro.svg)](https://www.npmjs.com/package/@percy/maestro)

Maestro client library for visual testing with [Percy](https://percy.io).

Supports full DOM capture for Maestro **web flows** — multi-browser, multi-width, cross-origin iframes, ignore regions — identical feature surface to [`@percy/selenium-webdriver`](https://github.com/percy/percy-selenium-javascript) and [`@percy/playwright`](https://github.com/percy/percy-playwright). Plus a screenshot-upload path for Maestro **mobile flows** (iOS / Android).

## Install

```sh
npm install --save-dev @percy/maestro @percy/cli
```

Install the [Maestro CLI](https://docs.maestro.dev) separately (`curl -Ls "https://get.maestro.mobile.dev" | bash`).

## Usage (web flows)

Exactly like `percy exec -- playwright test` — just swap `percy exec` for `percy-maestro exec`:

```sh
export PERCY_TOKEN="<your-web-project-token>"
percy-maestro exec -- maestro test flow.yaml
```

Inside the YAML flow, call Percy at each capture point via `runScript:` (this is the one piece that differs from Selenium/Playwright, because Maestro YAML does not have user-written JavaScript):

```yaml
url: https://example.com
---
- launchApp
- runScript:
    file: ../node_modules/@percy/maestro/scripts/snapshot.js
    env:
      PERCY_SNAPSHOT_NAME: "Home"
      PERCY_SNAPSHOT_WIDTHS: "375,1280"

- tapOn: "Sign in"
- runScript:
    file: ../node_modules/@percy/maestro/scripts/snapshot.js
    env:
      PERCY_SNAPSHOT_NAME: "Sign in page"
```

That's it. Percy renders each snapshot in Chrome/Safari/Firefox/Edge across every configured width, same as Selenium/Playwright builds.

### Options (via `env:`)

| Env var | Maps to | Notes |
|---|---|---|
| `PERCY_SNAPSHOT_NAME` | `name` | Required |
| `PERCY_SNAPSHOT_WIDTHS` | `widths` | `"375,1280"` |
| `PERCY_SNAPSHOT_MIN_HEIGHT` | `minHeight` | |
| `PERCY_SNAPSHOT_PERCY_CSS` | `percyCSS` | |
| `PERCY_SNAPSHOT_SCOPE` | `scope` | CSS selector |
| `PERCY_SNAPSHOT_ENABLE_JS` | `enableJavaScript` | `"true"` |
| `PERCY_SNAPSHOT_IGNORE_REGIONS` | `ignoreRegions` | JSON array |
| `PERCY_SNAPSHOT_CONSIDER_REGIONS` | `considerRegions` | JSON array |
| `PERCY_SNAPSHOT_SYNC` | `sync` | `"true"` |
| `PERCY_SNAPSHOT_RESPONSIVE` | `responsiveSnapshotCapture` | `"true"` |

### `createRegion()` helper

```js
const { createRegion } = require('@percy/maestro');

const ignoreRegions = [
  createRegion({ top: 0, right: 0, bottom: 100, left: 0 }),
  createRegion({ elementXpath: '//div[@id="ad-banner"]' }),
  createRegion({ elementCSS: '#timestamp', algorithm: 'ignore' })
];
process.env.PERCY_SNAPSHOT_IGNORE_REGIONS = JSON.stringify(ignoreRegions);
```

## Usage (mobile flows)

For native Android / iOS Maestro flows, upload screenshots to App Percy:

```yaml
appId: com.example.app
---
- launchApp
- takeScreenshot:
    path: ./screenshots/home
```

```sh
percy exec -- bash -c 'maestro test flow.yaml && percy-maestro upload --dir ./screenshots'
```

Device metadata (model, OS, orientation) is auto-detected via `adb` / `xcrun simctl`.

## CLI reference

```sh
percy-maestro exec -- <command>            # Run any command with Percy + capture server active (web flows)
percy-maestro upload [options]             # Upload Maestro screenshots to App Percy (mobile flows)
percy-maestro serve                        # (Advanced) Start only the capture server
```

## Feature parity with `@percy/playwright`

| | Playwright | Maestro |
|---|---|---|
| DOM capture via `@percy/dom` | ✅ | ✅ |
| Multi-browser render (Chrome/Safari/Firefox/Edge) | ✅ | ✅ |
| Multi-width render | ✅ | ✅ |
| Responsive capture (viewport per width) | ✅ | ✅ |
| Cross-origin iframe serialization | ✅ | ✅ |
| Cookies captured & included | ✅ | ✅ |
| `ignoreRegions` / `considerRegions` / `regions` | ✅ | ✅ |
| `createRegion()` helper | ✅ | ✅ |
| `minHeight`, `percyCSS`, `scope`, `enableJavaScript` | ✅ | ✅ |
| `sync` mode | ✅ | ✅ |
| `discovery` / `additionalSnapshots` | ✅ | ✅ |
| `percyScreenshot()` (Percy on Automate) | ✅ | N/A (Maestro not on BrowserStack device cloud) |

## Architecture

```
percy-maestro exec -- maestro test flow.yaml
  │
  ├─ percy-maestro process starts capture server on :5339
  │     └─ CDP ↔ Chromium  (discovered via DevToolsActivePort file)
  │            runs PercyDOM.serialize() in page context,
  │            enumerates cross-origin iframes via Target.getTargets,
  │            captures cookies via Network.getAllCookies
  │
  └─ spawns `percy exec -- maestro test flow.yaml` as subprocess
        ├─ Percy server (:5338)  starts build lifecycle
        └─ maestro test runs the YAML flow
              └─ runScript: snapshot.js  →  http.post to :5339  →  :5338
```

## License

MIT
