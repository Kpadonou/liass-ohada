# Mapping domaines Liass-OHADA ↔ références OHADA/SYSCOHADA

Ce fichier indique à Codex quelles références consulter selon le module métier à modifier dans Liass-OHADA.

## Priorité générale des références

1. `syscohada-plan-comptable.md`
2. `acte-uniforme-comptabilite-information-financiere.md`
3. `acte-uniforme-systeme-comptable-entites-but-non-lucratif.md` lorsque l’organisation est une association, ONG, projet de développement ou autre entité à but non lucratif
4. `acte-uniforme-droit-commercial-general.md`
5. `acte-uniforme-societes-commerciales-gie.md`

## Comptabilité générale

Références principales :
- `acte-uniforme-comptabilite-information-financiere.md`
- `syscohada-plan-comptable.md`

À utiliser pour :
- plan comptable ;
- journaux ;
- écritures comptables ;
- lignes d’écriture ;
- grand livre ;
- balance ;
- bilan ;
- compte de résultat ;
- tableau des flux de trésorerie ;
- notes annexes ;
- clôture et ouverture d’exercice ;
- audit trail comptable.

Règles pour Codex :
- ne pas inventer de classe comptable ;
- ne pas exposer les clés de persistance DynamoDB dans les DTO frontend ;
- centraliser les règles comptables dans le domaine/backend ;
- ajouter des tests pour toute règle de validation comptable.

## Plan comptable

Référence principale :
- `syscohada-plan-comptable.md`

À utiliser pour :
- création de comptes ;
- validation du numéro de compte ;
- libellés de comptes ;
- classes comptables ;
- comptes auxiliaires rattachés aux tiers.

Règles pour Codex :
- conserver le vocabulaire SYSCOHADA ;
- autoriser les comptes propres à une organisation sans modifier le référentiel de base ;
- utiliser un identifiant technique séparé du numéro de compte affiché.

## États financiers

Références principales :
- `acte-uniforme-comptabilite-information-financiere.md`
- `syscohada-plan-comptable.md`

À utiliser pour :
- bilan ;
- compte de résultat ;
- tableau des flux de trésorerie ;
- notes annexes ;
- comparabilité des exercices ;
- états annuels.

## Clients, ventes et créances

Références principales :
- `syscohada-plan-comptable.md`
- `acte-uniforme-droit-commercial-general.md`

À utiliser pour :
- factures clients ;
- paiements clients ;
- avoirs ;
- lettrage ;
- créances ;
- écritures automatiques de vente et d’encaissement.

## Fournisseurs, achats et dettes

Références principales :
- `syscohada-plan-comptable.md`
- `acte-uniforme-droit-commercial-general.md`

À utiliser pour :
- factures fournisseurs ;
- paiements fournisseurs ;
- dettes ;
- charges ;
- immobilisations acquises ;
- écritures automatiques d’achat et de règlement.

## Stock

Références principales :
- `syscohada-plan-comptable.md`
- `acte-uniforme-comptabilite-information-financiere.md`

À utiliser pour :
- produit ;
- mouvement de stock ;
- stock actuel par lot ;
- sortie détail ;
- valorisation des entrées et sorties ;
- FIFO, CMUP ou autre méthode retenue par configuration métier ;
- écritures automatiques de stock.

## Immobilisations

Références principales :
- `syscohada-plan-comptable.md`
- `acte-uniforme-comptabilite-information-financiere.md`

À utiliser pour :
- immobilisations ;
- plans d’amortissement ;
- dotations ;
- cessions ;
- mises au rebut ;
- dépréciations ;
- écritures automatiques.

## Données légales des sociétés

Référence principale :
- `acte-uniforme-societes-commerciales-gie.md`

À utiliser pour :
- forme juridique ;
- dénomination sociale ;
- sigle ;
- siège social ;
- capital social ;
- objet social ;
- RCCM ;
- durée ;
- associés ;
- organes sociaux.

## Commerçants, entreprenants et obligations commerciales

Référence principale :
- `acte-uniforme-droit-commercial-general.md`

À utiliser pour :
- commerçant ;
- entreprenant ;
- actes de commerce ;
- fonds de commerce ;
- RCCM ;
- obligations comptables du commerçant ;
- prescription commerciale.

## ONG, associations, projets de développement et entités à but non lucratif

Référence principale :
- `acte-uniforme-systeme-comptable-entites-but-non-lucratif.md`

À utiliser pour :
- associations ;
- ordres professionnels ;
- projets de développement ;
- bailleurs de fonds ;
- dons ;
- cotisations ;
- fonds affectés ;
- états financiers des entités à but non lucratif.

## Règles transversales pour Codex

Codex doit :
- lire les fichiers de référence pertinents avant de modifier le code métier ;
- citer dans son résumé les références consultées ;
- indiquer les incertitudes lorsque la règle n’est pas couverte par les références ;
- éviter d’implémenter des règles OHADA directement dans les composants UI ;
- privilégier les services de domaine, constantes, schémas de validation et tests automatisés.
