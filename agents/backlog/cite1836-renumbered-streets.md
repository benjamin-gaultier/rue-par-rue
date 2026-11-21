---
stream: cite1836
priority: 2
status: done
done: 2026-11-21, PR #23 — first slice: the plans' index is the source. Sheets with a corrected number are read (169 → 255 sheets), a house is tried at its second address, fits are checked against the sheet's scale: 93 → 114 traced; the 24 sheets left are in cite1836-renumbered-concordance
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

Result (PR #23):
- The index of the plans (Archives nationales) notes a second address for some houses ("et 3 rue des Deux-Ermites"). 5 sheets on the renumbered streets have one on a street the cadastre knows; 2 fit and are traced (rue de Constantine n°2, rue de la Cité n°8).
- The index writes 85 Cité addresses as "n°22 [en fait : 20]"; the parser dropped them all. The written number is the cadastre's. 25 more sheets traced this way.
- The corrected ("en fait") numbers are a later numbering and do not help: 3 of the 4 sheets that fit only the corrected number's parcel land on a parcel another traced sheet holds.
- 24 sheets are left without any old address: rue d'Arcole 11, rue de Constantine 9, rue de la Cité 4. See cite1836-renumbered-concordance.
