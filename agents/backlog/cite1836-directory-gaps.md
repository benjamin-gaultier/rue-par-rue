---
stream: cite1836
priority: 4
status: open
added: 2026-11-27
needs: [cite1836-shop-names]
---
# Directory entries left out of the 1836 match

Why: of 10,336 entries of the 1835 and 1837 directories in the Cité box, 3,744 are left out (`python -m rpr directories --area cite` prints the causes): 1,355 placed only on a street, 1,090 whose printed number the geocoder did not find (often "32 bis" found as "32"), 925 whose name and number fall on different lines of an OCR block, 239 with no name, 135 placed on an atlas of another year.

Done when: the "bis" and "ter" numbers are matched to the Vasserot points that carry them, entries placed only on a street are matched where the OCR text gives a number the street has, and the README gives the new counts, with a hand check of 20 recovered entries against their Gallica page.

Notes:
- The years 1829, 1832, 1833, 1838, 1839 and 1840 are in the same zip (`LISTNOMS_ZIP` in `pipeline/rpr/sources/directories.py`); ListProfs (lists by trade) is a second zip. Adding years would show who stayed and who left, but a card for 1836 should keep to the nearest.
- The 1836 Vasserot points do not cover the squares (place Dauphine, cour de la Sainte-Chapelle): those use SoDUCo's point on Jacoubet's atlas (`placed: jacoubet`).
