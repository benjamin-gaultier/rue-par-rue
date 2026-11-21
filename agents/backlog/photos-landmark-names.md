---
stream: photos
priority: 3
status: open
added: 2026-11-21
needs: []
---
# Landmarks under another form of their name, or in the next arrondissement

Why: About 30 captions name a building the landmark gazetteer holds, under a form it does not know or in the wrong arrondissement: "Bibliothèque nationale" (16), "Domaine du Palais-Royal" and other Palais-Royal forms (5), Saint-Nicolas-des-Champs (5), the École des Beaux-Arts and the lycée Condorcet given the next arrondissement.

Done when: these name forms match their building, a landmark one arrondissement off is placed and flagged as streets are (`caption_arrondissement`, confidence × 0.6), placed count goes up, and 20 newly placed photos checked by hand are all right.

Notes:
- The gazetteer is `pipeline/rpr/sources/monuments.py`; the landmark step and the neighbouring-arrondissement rule for streets are in `pipeline/rpr/geocode.py`.
- Two small parser slips seen at the same time: "Hôtel de Bouville, ancienne mairie du 10ème arrondissement, 13 et 15 rue de Verneuil, 7ème arrondissement" is read as the 10th, and "Rue des Nonnains d'Hyères.Juillet 1899" keeps the date in the street name.
