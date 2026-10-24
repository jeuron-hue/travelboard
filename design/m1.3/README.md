# M1.3 approved mockup (24/10/26)

Source of the mockup Gary approved on 24/10/26 for SPEC.md 7C. Each `.dc.html` is one phone screen at 390 x 844 in a Design canvas format; read them as reference markup, not as code to ship. The `*Dark` files mount the light file with `dark` on, so the night values are the `dark` set inside each light file's script.

- `Main.dc.html`: day view
- `Capture.dc.html`: capture and edit
- `Journal.dc.html`: journal with the inline field
- `Panel.dc.html`: Settings sheet
- `Icons.dc.html`: app icon options; B (notebook and pin) chosen
- `icon-b.svg`: option B drawn in paths only, the source of `icons/*.png` (session B, 24/10/26)
- `make-icons.cjs`: renders `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` from it (dev only; `npm install` in `checks/headless` first)

Tokens, type and sizes are pinned in SPEC.md 7C.8. Sample text is invented for the mockup.
