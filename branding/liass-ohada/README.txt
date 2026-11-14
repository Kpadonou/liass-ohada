Liass-OHADA | Correction ciblée du pack Ready for Dev (PNG)

CONTENU
- 8 variantes de logos PNG, avec noms et géométrie correspondants
- 2 visuels sociaux clairs regénérés depuis le vrai logo horizontal bleu/or
- VISUAL_AUDIT.jpg : comparaison côte à côte des variantes
- asset-map.json : traçabilité et empreintes SHA-256

IMPORTANT
- Ce ZIP est un correctif, pas un nouveau pack complet.
- Conserve la transparence des 8 PNG (vérifiée), sans altération ni revectorisation.
- Aucun SVG généré ni modifié.
- Les icônes web (favicon, PWA) n'ont pas été retouchées : elles proviennent déjà d'un véritable monogramme.
- Bien vérifier le visuel des 8 logos avant remplacement sur le dépôt.

MISE À JOUR DU PROJET (depuis racine du dépôt)
1. Sauvegarder branding/liass-ohada et les éventuels changements Git.
2. Dézipper le contenu de l'archive directement dans branding/liass-ohada/ (fusionner les sous-dossiers).
3. Prévisualiser la synchronisation :
  python3 scripts/sync_liass_brand.py --frontend packages/frontend --target assets
4. Synchroniser :
  python3 scripts/sync_liass_brand.py --frontend packages/frontend --target assets --apply
5. Vérifier le mapping de liass-brand-assets.ts et les rendus des deux thèmes.
6. Faire les tests ciblés et committer uniquement les fichiers voulus.

Origine de la correction
Les noms horizontal-navy-gold et stacked-navy-gold avaient été associés respectivement au logo empilé et au monogramme.
Les sources vérifiées ont été réassociées aux bons noms.
