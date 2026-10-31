# Artae fork

This branch (`artae`) wires the generator to the Artae worldbuilding repo, which holds it as a submodule at `map/fmg`.

- `artae/server.ts`: Vite dev-server plugin. Reads and writes `.map` files under `<Artae>/map/worlds/`, serves canon articles from `<Artae>/canon/` as JSON (`/artae/api/canon`) and as pages (`/artae/canon/<id>`). The Artae root defaults to three levels up; override with `ARTAE_ROOT`.
- `src/artae/bridge.ts`: `window.artae`, the scripting API (load, save, apply operations with undo, sync canon notes). Loaded from `src/main.ts`.
- `?artae=<map>` in the URL opens that repo map after boot.
- **World profiles.** Everything that belongs to a setting rather than to the generator lives in a JSON profile, never in this fork: the elements and the geographic rule of each, the node level range and the base mana levels add in, the pantheon tints and the institution kinds with their name patterns and purposes, and the grammar of generated names. The dev server serves `<Artae>/map/profiles/<setting>.json` at `/artae/api/profile/<setting>`, where the setting is the first segment of a map name (`world/layer` → `world`). Without one, `src/artae/default-profile.json` (neutral placeholders) is used. Format: `src/artae/profile.ts`.
- **Rules are expressions, not code** (`src/artae/expressions.ts`, parsed once, no `eval`): numbers, the per-cell signals listed in `SIGNAL_NAMES` (`src/artae/elements.ts`, each 0..1), `+ - * /`, `^` for powers, parentheses, `min`, `max`, `clamp(x[, lo, hi])`, `pow(x, y)` and `if(cond, then, else)`. An element with `poles` gives each pole its own rule; the strongest wins in each cell.

Usage and canon rules live in the Artae repo: `.claude/skills/map/SKILL.md`.

Upstream changes: `git fetch upstream && git merge upstream/master`.
