# Cinematic Glass Workspace — visual QA

Source: `/Users/cccc/Downloads/ChatGPT Image 2026年9月26日 01_13_44.png`.
Implementation evidence: `/Users/cccc/Desktop/共用/cinematic-workspace-review/`.
Primary comparison: `hubu/workspace-1672x941.png`; supplementary `muc/workspace-1672x941.png`, `hubu/composer-detail.png`, `hubu/tool-detail.png`, and native Electron quota captures under `electron/`.

## Capture and comparison

Source and browser comparison are both 1672 × 941 pixels, CSS viewport 1672 × 941, deviceScaleFactor 1. No density normalization or browser chrome crop required. Electron captures use a 1586 × 992 CSS window; its separate 80 × 80 orb and panel captures verify native-only components, not geometry parity with the browser image.

State: real Solid session renderer, schema-valid local fixtures for a Chinese writing session and completed Shell/Edit/Read, actual model header, empty composer. Fixtures exist only in tests; no product hardcoded conversations or model calls. Video served from the user-specified asset, actual existing university crests. Native quota and rewards use the existing isolated HTTP/IPC test harness.

Both brands checked at 1672×941, 1366×768, 1440×900, 1512×982, 1920×1080, 2560×1080, 900×640, 390×720, 935×522. Composer/send remain in view and the document has no horizontal overflow. Narrow layouts keep existing session/review and titlebar controls; sidebar collapses to a rail, then hides. Low-height views scroll content instead of shrinking the editor to unusable dimensions.

Full-view comparisons established the lake/glass/sunset palette, persistent shell, clear document hierarchy and floating composer. Detail comparisons checked tool trigger height, icon visibility, disabled send, composer controls, native orb ring and quota panel. Source text is readable at native resolution; no screenshot of the reference was used as a UI/background asset.

## Findings and repair history

- **P1, native material inheritance:** first Electron capture lacked token values because desktop HTML does not set the website's `data-brand`. Replaced that dependency with the actual campus workspace lifecycle attribute; added a native computed-token assertion. The corrected native quota screenshot has white text, glass surfaces and lake-blue/warm progress.
- **P2, tool/card density:** first screenshot clipped Shell triggers to 32px and missed nested Edit containers. Scoped trigger min-height and descendant card rules now give 58px desktop rows and preserve real expansion. Read uses the existing grouped-context control with a real open-file icon.
- **P2, theme text:** initial headers/portal text inherited light-theme aliases. Campus tokens now override both legacy and V2 Tailwind aliases, including nested color-scheme containers. Settings modal and session title remain legible.
- **P2, narrow horizontal overflow:** original header negative margins exceeded the 390px window. Narrow header margins now match the shell's 6px padding. Both-brand matrix passes.
- **P2, missing icon:** the initial Read symbol did not exist in the established icon registry. Changed to its existing `open-file` asset; typecheck and screenshot confirm it renders.

All P1/P2 findings above have post-fix screenshots in the evidence directory. No actionable P0/P1/P2 visual findings remain.

## Required fidelity surfaces

- **Typography:** existing system/CJK font stack retained; 15px/1.8 body, 20px H2, 18px session title, 12–14px tool metadata. Real user request remains visible above the assistant, making the screen denser than the single-response reference; long content scrolls behind the fixed composer. No replacement fake content to force a pixel match.
- **Layout rhythm:** 244px sidebar, 26px gap, 1180px maximum session workspace, 1000px reading column, 14/20/28px card/workspace/composer radii. Reference proportions adapted to actual tab and review controllers. Sticky title is more opaque to keep scrolling text readable.
- **Colors/tokens:** blue-gray glass, off-white text, muted lake-blue, restrained sunset accents; semantic green/error tones preserved. Warm accent concentrated on focus, selected navigation and send; no broad neon/purple glow.
- **Image/asset fidelity:** exact supplied lake video and a local still extracted from it, proper cover crop, original university crests. Static fallback remains available when offline or reduced motion is enabled. Existing icon library retained; quota ring is a percentage visualization, not decorative raster substitution.
- **Copy/content:** all ordinary product text reuses existing localized strings; `workspaceName` comes from brand config. Model/duration/tool states/quotas remain real runtime values. Reference-only knowledge-base/tools/marketing shortcuts were not fabricated; navigation exposes existing sessions/new/project/commands/settings actions.

## Interaction and accessibility evidence

Browser tests cover tool running/success/error, Shell/Read expansion, Markdown/code block, streaming updates, multi-line draft and focus, actual stop endpoint, settings modal/Escape, responsive inputs and reduced motion; no browser page errors. Existing regressions cover project/model/attachment/send/session creation and tab switch/close. Native tests cover quota drag, keyboard open/close, reset confirmation, count/charge/reward events, input focus retention and static reduced motion. Final production artifact startup is recorded separately in the delivery report.

## Follow-up polish / limits

P3: the native existing 80px draggable quota control is quieter/smaller than the reference's large decorative orb; retained for input-area clearance and existing drag bounds. The reference footer and unimplemented navigation items are intentionally absent. Video frame changes make the exact sunset position nondeterministic. No claim of pixel-identical reproduction or long-duration multi-day soak testing.

Implementation checklist: completed — material tokens; shell/background; real sidebar actions; document hierarchy; tool cards; composer; quota/reward material; responsive/reduced-motion; browser/native visual checks.

## Home search surface follow-up — 2026-09-26

P2: the home search/date sticky headers retained legacy opaque backgrounds and a solid fade, producing the dark rectangle reported in the user screenshot. Scoped campus styles now make the wrappers transparent at rest, retain a bordered glass search field, and give the existing search popup matching materials. The existing scroll controller exposes a boolean to raise rounded glass headers only while scrolled, keeping passing rows from interfering with the controls.

Post-fix evidence: `home-glass-fixed.png`, `home-glass-scrolled.png`, `home-glass-search.png` (1600×1000, real renderer with 45 local fixture sessions). Search results and Escape dismissal passed. App typecheck, targeted lint, browser visual review, desktop production build and mac-arm64 package smoke passed. No real provider calls. Source changes are limited to home hooks/scroll state and campus CSS.

Updated local 2.0.8 package: `packages/desktop/dist/cinematic-hubu-home-fix/hubu-ai-2.0.8-mac-arm64.dmg`. This does not replace the running preview or publish a release.

final result: passed
