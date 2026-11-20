# Rue par Rue: notes for Claude sessions

A street view of Paris through time; see [README.md](README.md). The app is in `web/` (Vite, TypeScript, MapLibre, three.js), the data pipeline in `pipeline/` (Python package `rpr`). Sources and licences are in [DATA_SOURCES.md](DATA_SOURCES.md).

## Standing rules

- **Nothing is invented.** Every position, date, height and shape comes from a source. A reasoned value (a garden's opening year from its history, an estimated height) is flagged in the data and said in the app. A photo that cannot be placed stays unplaced.
- **Licences travel with the data.** Keep each source's licence and credit. Databases derived from the Vasserot data stay ODbL. Do not use what DATA_SOURCES.md says cannot be reused.
- **Generated data is rebuilt, never hand-edited.** `web/public/data/` and `pipeline/cache/` come from `python -m rpr …` commands. On a merge conflict in a generated file, take main's version and run the command again.
- **Shaders must compile on Windows Chrome.** ANGLE hands them to Direct3D's FXC compiler, which is slow on long, branchy code and can overflow its stack on deep call chains (PR #10). Keep functions shallow, loops small, and split rarely used code into its own shader variant as `web/src/cityshaders.ts` does for wall families. `tools/fxc/` measures compile time.
- **Checks before every PR:** in `web/`: `npm run typecheck`, `npm test`, `npm run build`. In `pipeline/` (in a venv): `pip install -e ".[dev,geo]"`, then `pytest -q`. CI runs the same on every PR.
- **Pull requests:** branch from `origin/main`, one change per PR, never stacked on another open PR. Merge commits (`gh pr merge --merge`). Measured before/after numbers in the description.
- **Secrets stay in GitHub.** Never read, print or change `PARISMUSEES_TOKEN` or any other secret.
- **Plain English** in docs, comments and PRs: short sentences, concrete words, the README's tone.

## Agents

Scheduled agents follow [agents/PROGRAM.md](agents/PROGRAM.md) and take work from [agents/backlog/](agents/backlog/).
