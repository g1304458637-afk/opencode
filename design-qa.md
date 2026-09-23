# Quota Energy Glass — visual QA

final result: passed

## Source and scope

Source visual truth: `/Users/cccc/Downloads/Codex 图像 2026年9月23日 01_55_44.png`.
Written requirements: `/Users/cccc/.codex/attachments/ee0ab062-20ca-4811-a5bd-a653e330b1d6/已粘贴的文本.txt`.
Only one reference image was attached. The written brief explicitly requests maintainable layered CSS and restrained energy/glass material rather than literal pixel duplication. It overrides the generic skill's preference for raster assets. Existing Solid renderer is retained.

Source pixels: 1586×992; original device density is not supplied. Browser implementation: 1586×992 viewport and saved full-view image. Native Electron captures also use 1586×992 for the quota states. No false assumption of source CSS density: layout is evaluated by component hierarchy and material treatment, not a claimed pixel-perfect score. Production panel width is 304 CSS px; orb is 80 CSS px.

## Evidence

- Full-view comparison, opened together with source: `/Users/cccc/Desktop/共用/quota-energy-review/browser/quota-final.png`.
- Actual Electron full view: `/Users/cccc/Desktop/共用/quota-energy-review/muc/quota-100.png`.
- Focused native panel: `/Users/cccc/Desktop/共用/quota-energy-review/muc/quota-panel-detail.png`.
- Focused native orb: `/Users/cccc/Desktop/共用/quota-energy-review/muc/quota-orb-detail.png`.
- Four states, charging, full pulse, reduced motion and responsive variants: `/Users/cccc/Desktop/共用/quota-energy-review/muc/` and `/Users/cccc/Desktop/共用/quota-energy-review/hubu/`.

Comparison state: expanded panel with two windows at 100%, idle orb, dark quota material. The local browser fixture matches the reference's dark conversation-like backdrop and labels. Native captures show the existing lake new-session page and test subscription Pro; these surrounding-content differences are intentional and outside quota scope. Fixture data and real account data are not confused.

Source, full implementation and focused implementation images were opened in the same review call; the native panel/orb captures were subsequently inspected at readable size. The intermediate browser `quota-detail.png` crop is unsuitable because browser clip coordinates were density-scaled; it is not used as fidelity evidence.

## Required surfaces

- Typography: existing native system font stack retained; quota heading 13px, orb value 21px, tabular numerals, high contrast light text, 10–11px secondary text. Source hierarchy preserved; numeric content stays separate from glow layers. Long plan header can wrap.
- Layout: one plan header, brand/version/account row, two quota windows, status/fallback, reset credit/action, expiry, refresh, management action. Spacing and dividers are explicit. Panel opens above/below the draggable orb according to available room; low height scrolls internally.
- Color/tokens: charcoal glass base; ruby/rose energy and pink-white reflection share scoped custom properties. Lower percentages reduce energy level/intensity. No broad red panel, strong neon, rapid flash or game-like particle burst.
- Image/material quality: orb and bars are DOM/CSS gradients, as explicitly requested. A bounded blurred fluid layer, shell/refraction/highlight/inner shadow and subtle orbit produce depth. No raster sphere, Canvas, WebGL, generated icon assets or new animation dependency.
- Copy/content: original business labels and real IPC data remain. Financial logic, endpoints, subscription and period values are unchanged. Fixture controls never enter the desktop renderer bundle.

## Findings and iteration history

1. [P2, fixed] Assistive/synthetic clicks could toggle twice because both pointer-up and click toggled the panel. All toggling now occurs in click; pointer-up only persists a completed drag. Native keyboard Enter/Escape and drag-without-toggle checks pass.
2. [P3, fixed] The aura approached the screen edge with the former 8px clearance. Increased shared clearance to 16px and adjusted narrow panel width. Final browser full view and final native captures show the corrected clearance.
3. Short full-pulse verification initially skipped the 350ms phase because test assertion polling backed off. The test now observes that phase each frame; production timing was not lengthened. Both brands pass charge/fullPulse/settle checks.

No outstanding actionable P0/P1/P2 visual findings.

## Interaction and accessibility checks

Real Electron, both brands: 100/75/30/10; empty/stale/no subscription; reset confirmation and cancel; lost-response reconciliation and double-click protection; automatic period rollover animation; unchanged refresh and panel reopening do not replay it; reduced motion yields zero scoped animations; keyboard opening/closing; dragging near top; 768×640, 420×600 and 1000×420 panel bounds/no document overflow. The in-app browser additionally exercised four debug values and Reset preview by hand.

Final in-app browser reload: no new error logs. Earlier Vite HMR reconnect errors during batch formatting were resolved by reload. Quota E2E scope intentionally does not test live update feeds or real providers.

## Performance and limits

Only CSS idle transform/opacity loops. JS RAF exists only during the 2200ms charge and is canceled on completion, hidden document, reduced-motion change and disposal. One 3px fluid blur plus one panel backdrop blur. Final 5-second Electron samples: renderer CPU MUC 0.571%, HUBU 0.480%; GPU process CPU MUC 2.406%, HUBU 1.984%. No obvious process CPU anomaly in this sample. GPU hardware utilization and long-duration thermal/battery behavior were not measured.

## Implementation checklist

- [x] Production components and unified tokens integrated.
- [x] True reset/increased-quota detection; no fabricated 100%.
- [x] Development-only preview isolated from production build.
- [x] Lint, typecheck, unit tests, two builds and both native E2E suites passed.
- [x] Full and focused visual evidence reviewed; edge and click issues corrected.
- [x] Interactive local preview retained at http://127.0.0.1:4486.
