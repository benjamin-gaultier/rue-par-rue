---
stream: photos
priority: 2
status: open
added: 2026-11-22
needs: []
---
# Streets placed on a street of another name

Why: When no rule finds the caption's street, the last step takes whatever street the address base answers with a score of 0.8 or more, even under another name. Some of these are wrong placements: "Tourelle, place de l'Hôtel de Ville" sits on the place du Docteur Félix Lobligeois (17th), and "maison du 66 rue de Paris, Houdan" sat on the avenue de la Porte de Charenton before PR #30 took it off the map.

Done when: every photo placed by this last step (method `ban`, precision `street`, where the label's street is not the caption's name under `same_street`) is listed and read by hand, the wrong ones are unplaced or placed by a better rule, and the PR gives the counts: right, wrong, fixed.

Notes:
- Step 6 of `Geocoder._resolve` in `pipeline/rpr/geocode.py` ("Today's street with a close name"). The first step uses `_same_name`; this one only `_usable`.
- "Rue de Sévigné - Hôtel de Flesselles. 1898" is labelled "Rue Madame de Sévigné 75004 Paris" at confidence 0.2: check whether that is the rue de Sévigné.
- The place de l'Hôtel de Ville is in the places gazetteer or should be: see why `_place` did not find it first.
- Measure with `python -m rpr parismusees --offline`.
