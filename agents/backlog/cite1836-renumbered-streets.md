---
stream: cite1836
priority: 2
status: open
added: 2026-11-20
needs: []
---
# Old house numbers for the streets renumbered after 1836

Why: 19 Vasserot sheets carry an address on a street opened or renumbered after the cadastre was drawn (rue d'Arcole 10 sheets, rue de Constantine 4, rue de la Cité 3, rue Bossuet 2), so their footprints are not drawn.

Done when: a source giving the old number for each new one is found and written in DATA_SOURCES.md, and the sheets it covers are matched (fit still checked by IoU); or the item is blocked with what was searched.

Notes:
- The City's records name the former streets: rue d'Arcole = rue du Chevet-Saint-Landry + rue Saint-Pierre-aux-Bœufs (decision of 13 February 1837); rue de la Cité = rue de la Juiverie + rue de la Lanterne + rue du Marché-Palu (1834); rue de Constantine replaced the rue de la Vieille-Draperie.
- Shape alone does not work: PR #17 fitted each sheet to every parcel of the former streets, and the runner-up was within 0.01 to 0.04 IoU of the best for 15 of 17 sheets.
- Places to look: the sheets themselves (some note the former address in the margin), the Bottin / Almanach du commerce of 1836–1840 (the SoDUCo geocoded directories list the same shop before and after), Lazare's Dictionnaire des rues (1844).
