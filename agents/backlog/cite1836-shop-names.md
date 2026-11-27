---
stream: cite1836
priority: 3
status: done
done: 2026-11-27, PR #37 — first slice: the SoDUCo directories of 1835 and 1837 (Etalab 2.0) matched to the 1836 buildings, 4,766 listings in 1,789 buildings (811 in 322 on the island), shown on the building card with a link to each page; lettering them on the fronts is cite1836-shop-fascias, the entries left out are cite1836-directory-gaps
added: 2026-11-20
needs: []
---
# Shop names from the trade directories on the 1836 facades

Why: Fascia lettering is drawn by trade and year (`web/src/signs.ts`) but the names are not real. The SoDUCo trade directories (1787–1914, geocoded) list who kept shop at each address.

Done when: shops on the Cité show the trade and name listed for their address in a directory of 1830–1840, with the source on the building card; addresses with no entry keep generic lettering.

Notes:
- DATA_SOURCES.md lists the SoDUCo directories as planned. Check the licence and write it there first.
- Match through the 1836 address points, as the photo geocoder does.
