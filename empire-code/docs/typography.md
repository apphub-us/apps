# Typography: two font roles (EC-TYPOGRAPHY-1)

The app declares two font roles, each with one job. They are defined once per
document as CSS custom properties with the same names and the same stacks:

- `candidate/browser/style.css` (`:root`) for the shell and Rozmowa
- `core/mobile.html` and `candidate/browser/workspace/mobile.html` (`:root`)
  for Roboty, Narzędzia and Przepisy

```css
--ec-family-ui:   system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
--ec-family-mono: Menlo, ui-monospace, 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace;
```

What is established is these two declared stacks. No font file is bundled and
no web font is loaded for them, so the face actually drawn is whichever listed
name the device and browser have available, ending in the generic `sans-serif`
or `monospace`. Which face a given phone or computer picks has not been
verified; a declared family string is not proof of the rendered font.

## Which role to use

| Role | Token | Use it for |
|---|---|---|
| UI / reading sans | `--ec-family-ui` | navigation, screen and section titles, tool-card names and taglines, prose, help and hint text under fields, explanatory notes and disclaimers, validation, error and status messages, captions under result-row labels, job and conversation names, free-text entry, action-button and back-navigation labels |
| Technical mono | `--ec-family-mono` | numeric inputs, values and results, units, AWG and conductor identifiers, NEC / NYCEC references, code-edition and version badges, compact technical field labels, tables |

Rules:

- A heading is the UI role at a different weight, size or letter-spacing. There
  is no third family for titles.
- Explanatory text is the UI role, even when it mentions a value or a code
  section. Mono is for things read as data.
- Where one block holds a conversion line and a sentence (the Converter's
  torque, temperature and mm² outputs), the conversion line is mono and the
  sentence under it is the UI role.
- Write `font-family: var(--ec-family-ui)` or `var(--ec-family-mono)`, in
  stylesheets and in inline styles alike. Do not name a font directly.
- An editable field keeps at least 16px in either role
  (`core/docs/ui-focus-policy.md`).

## Two places that do not use the tokens

- The diagram palette `SV.font` / `SV.fontB` in `mobile.html` writes the two
  stacks out in full, in the same order. This is an implementation choice for
  the generated SVG text; change them together with the tokens.
- `candidate/browser/workspace/host-core.css` is a byte-protected baseline file
  and still carries an older `body` font rule. `mobile.html` overrides it with
  `html body { font-family: var(--ec-family-ui); }`.

## Fonts that are linked but not referenced

The standalone `core/mobile.html` still links a Google Fonts stylesheet for IBM
Plex Mono, Inter and Montserrat, and `core/sw.js` still pre-caches that URL;
existing tests require the link. No rule refers to those families any more.
The hosted copy has no such link.
