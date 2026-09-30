# HUBU AI branding update (planned release 2.1.3)

This change updates the HUBU campus banner emblem, replaces the application icon
with the supplied blue/gold Wuxuexi book symbol, and uses HUBU AI for the Windows
application menu heading and window/page title.

## Assets

- The campus banner is synchronized in `../app/src/assets/hubu/hubu-hero.png`
  and `src/renderer/assets/hubu-hero.png`.
- The emblem reference is the university's official
  [logo design standard](https://vi.hubu.edu.cn/info/1003/1015.htm).
  The banner is an AI-assisted localized edit against that reference, not an
  official university-issued banner or a newly downloaded vector emblem.
- The desktop icon uses only the book symbol from the user-supplied Wuxuexi
  brand sheet. `icons/hubu/icon.png` is the transparent square master;
  `icon.ico` contains 16, 24, 32, 48, 64, 128 and 256 pixel representations.
- PNG, ICO, ICNS and Dock variants live in `icons/hubu`. The ICO and ICNS copies
  in `resources/hubu` must stay synchronized. Prebuild copies the complete icon
  set to `resources/icons`; HUBU packaging also copies it outside the ASAR to
  the `resources/icons` directory read by BrowserWindow.
- Windows executable resource editing is enabled for HUBU. Cross-platform
  Windows packaging therefore requires Wine; a native Windows build is supported.

## Build on Windows (PowerShell)

Use Bun 1.3.14 or a compatible version. Git must check out real symbolic links;
otherwise `packages/app/src/custom-elements.d.ts` is a pathname instead of a
TypeScript declaration and public assets are also invalid.

```powershell
bun install --ignore-scripts --frozen-lockfile
Set-Location packages/desktop
$env:OPENCODE_CHANNEL = 'hubu'
$env:OPENCODE_VERSION = '2.1.3'
$env:BUN_CONFIG_REGISTRY = 'https://registry.npmjs.org'
bun ./scripts/prepare.ts
bun x electron-vite build
bun run package:win --publish never '--config.artifactName=hubu-ai-2.1.3-win-x64.exe'
```

`prepare.ts` writes the desktop package version and performs prebuild. Setting
`OPENCODE_VERSION` without running prepare does not update package.json. The
package.json version change is a local release preparation step, not part of
this branding commit.

## Release handoff

The operator must merge this branch into the tree used for production and keep
their production update configuration. The public HUBU source currently disables
the built-in updater in `src/main/constants.ts` and does not define a generic
publish URL for HUBU. This branding change does not claim to fix that separate
source/production difference. A local test installer is not a production release.

Before releasing, confirm that 2.1.3 is still available; verify the production
gateway, authorization flow, update URL and updater behavior; inspect the menu,
taskbar preview, EXE, installed desktop shortcut and campus banner. Use the
operator's signing workflow. Upload the installer and blockmap before latest.yml,
and back up the previous update manifest first. Do not replace the existing app
identity or protocol while integrating these changes.

## Image generation record

The built-in imagegen tool was used (no API/CLI fallback). The final prompts were:

> Create a clean production app-icon asset matching ONLY the blue-gold book
> symbol in the attached brand sheet. Smooth vector illustration of the identical
> blue W-shaped open book with two gold pages rising above. Exact same design.
> ONE centered logo, smooth broad blue/cyan gradient panels and warm gold pages,
> simple clean curves. Transparent 1024 square canvas, logo width 820 px, natural
> width:height ratio about 1.4. Perfectly clean solid silhouette, no noise or
> texture, no specks, no glow, no reflection, no outline, no dark halo, no drop
> shadow. All space around and inside the center gap must be fully transparent.
> Do not include any of the typography, panels, or background from the brand sheet.

> Precise localized edit. Image 1 is the edit target: a wide Hubei University
> campus banner. Image 2 is supporting official logo reference: the circular
> green HUBEI UNIVERSITY emblem on the right of the official standards sheet.
> Replace ONLY the small distorted school emblem at the TOP CENTER of image 1
> (roughly x=735..938, y=15..214 in the original 1672x941 banner) with a
> front-facing perfectly round, upright, undistorted rendering matching exactly
> the official emblem in image 2. Its top Chinese characters must read 湖北大学,
> lower English HUBEI UNIVERSITY, year 1931, and the central bell/phoenix design
> must match the official reference. Fit entirely inside original area, no crop,
> maintain circular aspect ratio. Preserve original banner landscape composition
> and dimensions. Keep EVERY other area unchanged: large 湖北大学 calligraphy,
> English HUBEI UNIVERSITY, motto, sky, leaves, gate, building, rock, bell,
> green/gold footer, all colors and all other text. No global repainting, no other
> design change. Output the complete corrected banner, not the standards sheet.
