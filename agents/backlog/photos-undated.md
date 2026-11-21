---
stream: photos
priority: 3
status: open
added: 2026-11-21
needs: []
---
# A reasoned date range for the photos marked "Sans date"

Why: 2,118 of the 9,423 photos have no year (1,927 from Paris Musées, 191 Albert-Kahn; 583 around the Cité). The app shows them in every year, and no era can count on them. Where the record names the photographer, the years they worked bound the date (Atget photographed Paris from about 1897 to 1927).

Done when: undated photos get a date range from a source in their record (the photographer's working years, a dated series, a date in the caption), flagged as reasoned with its method; the PR buckets the undated photos by what their record offers, gives the count dated, and checks 20 by hand; photos with nothing to go on stay undated.

Notes:
- The saved works are in `pipeline/cache/parismusees-works.json.gz`; `python -m rpr parismusees --offline` places them again without a token.
- The schema is `pipeline/rpr/photo.py`; a reasoned range must not read as a catalogued date on the photo card.
- A wide range is honest: do not narrow it without a source.
