# HUBU AI 2.1.4 branding repair

The production HUBU client is built from `hubu-main`. Its 2.1.3 release included
new icon files but still disabled unsigned Windows executable resource editing.
The workspace sidebar also used a separate, distorted `crest.png`; updating the
campus banner did not update that sidebar.

## Active assets

- `../app/src/assets/hubu/crest-official.jpg` is the unmodified image from the
  [Hubei University emblem page](https://www.hubu.edu.cn/info/1024/1036.htm),
  [direct image](https://www.hubu.edu.cn/__local/6/6F/56/0CAB2AB6DE17804A63CDDBE34E4_832687D0_2DBE0.jpg).
  `WorkspaceSidebar` frames its circular emblem through an SVG viewBox, preserving
  the original lettering and proportions. This sidebar emblem is not AI generated.
- `icons/hubu` contains the blue/gold Wuxuexi book icon derived from the supplied
  brand sheet. Windows EXE/installer icons come from `resources/hubu/icon.ico`.
  That ICO must match `icons/hubu/icon.ico`.
- `electron-builder.config.ts` copies `icons/hubu/icon.ico` and `icon.png` to the
  packaged `resources/icons` directory, where BrowserWindow loads them.
- HUBU Windows EXE resource editing is enabled with or without a certificate.
  Signing credentials remain optional and are not committed. Cross-building
  Windows packages requires Wine; native Windows builds are supported.
- The Windows menu heading, window title and HTML title use `HUBU AI`.
  The separate workspace name remains `HUBUCode`.

## Build and verify

Use the repository's pinned Bun version and real Git symbolic links.
From `packages/desktop`, run:

```powershell
# Production endpoints must be supplied by the existing release environment:
# HUBU_GATEWAY_URL, HUBU_UPDATE_FEED_URL, HUBU_MANIFEST_URL,
# HUBU_DOWNLOAD_BASE_URL, HUBU_WEBSITE_URL.
bun scripts/campus-build.ts hubu win-x64 --package
```

The desktop version comes from `resources/hubu/release.json`; neither
`OPENCODE_VERSION` nor editing package.json is the release version source.
Use `CAMPUS_LOCAL_BUILD=1` only for isolated testing. Do not publish those builds.

Before release, run the packaging configuration tests and type checks, then:

1. Enter the real workspace with an isolated test profile and inspect the round
   sidebar emblem, including its full Chinese/English text and 1931.
2. Inspect the built EXE's native icon and ProductName, not just icon files inside
   app.asar. Confirm `resources/icons/icon.ico` and `icon.png` exist outside ASAR.
3. Verify a shortcut targeting that EXE resolves to the book icon; inspect the
   Windows menu and taskbar title as well.
4. Record the tested source SHA. This repair uses version 2.1.4; preserve the
   already published 2.1.3 installers and history.
   Keep the production endpoints, app ID, protocol and signing policy intact.

## Earlier image generation record

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
