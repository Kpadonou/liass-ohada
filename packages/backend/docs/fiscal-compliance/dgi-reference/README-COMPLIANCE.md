# Référentiel e-MECeF Bénin – Liass-OHADA

## Finalité

Ces documents fournis par le Product Owner constituent le corpus initial de référence pour **implémenter et vérifier** la fiscalisation béninoise e-MECeF de bout en bout dans Liass-OHADA (Fiscal Compliance partagé, consommateurs Sales et Restaurants). Il ne s'agit pas d'un simple audit ou d'une validation de mapper.

Les 20 scénarios de l'annexe 2 de l'auto-déclaration SFE sont les critères d'acceptation minimaux explicitement requis par le Product Owner, avec des cas complémentaires si l'application en a besoin.

## Sources dans ce dossier

- `certification/Auto_declaration_de_SFE_avec_e-MECeF.docx` — procédure DGI, annexe 1, annexe 2 (20 scénarios et feuilles de preuves).
- `api/e-MECeF_API_v1.0.pdf` — API DGI v1.0 datée 15/01/2021 (demande, confirmation, consultation, tax group, clients, AIB, taxe spécifique, référence originale, etc.).
- `manuals/e-MECeF_Manuel_d'utilisation_v1.0.pdf` — manuel DGI 1.0 (parcours utilisateur, acheteur, article TTC, AIB, référence de l'avoir, facture normalisée et QR).
- `../compliance-matrix/dgi-sfe-20-tests-matrix.csv` — registre initial exhaustif de l'annexe 2, à tenir à jour avec IDs de tests, preuves, état et écarts. **Aucun statut PASS n'est présumé.**

Les documents historiques doivent être confrontés à l'API DGI TEST actuellement disponible et à sa documentation Swagger : https://developper.impots.bj/sygmef-emcf/swagger/index.html . Consigner toute divergence, faire confirmer par TEST/autorité et ne pas inventer de comportement.

## Couverture et règles

1. Quatre types de facture DGI : FV (vente intérieure), FA (avoir intérieur), EV (vente exportation) et EA (avoir exportation), avec leur référence fiscale originale pour FA/EA.
2. Six groupes A (EXO), B (TAX), C (EXP), D (MP), E (TPS), F (RES). **F = réservé**, et non synonyme de taxe spécifique. Reconnaître F et sa restriction ; ne pas en inventer le calcul ni prétendre à une implémentation opérationnelle sans spécification DGI.
3. AIB absent/1 %/5 %, taxe spécifique et taxe de séjour, conditions d'éligibilité, profils fiscaux et politiques applicables avec preuves.
4. Client : IFU, nom, adresse et contact ; validation conforme DGI. Opérateur, paiements, quantités entières/décimales, prix TTC, totaux, arrondis, corrections/remises applicables, descriptions.
5. Parcours : données de facture et profil figés, POST DGI, contrôle des totaux, confirmation PUT, preuve DGI, QR, document imprimable, journal et récupération sans double normalisation.
6. Respecter strictement la séparation TEST/PRODUCTION, les approbations DGI, le blocage des outcomes inconnus, la sécurité/RBAC, la propriété transactionnelle, les invariants DynamoDB, le mode multi-pays et les preuves REM SI existantes.
7. Tout scénario est `PASS` uniquement si (a) règle métier et parcours couverts, (b) tests ciblés réussis, (c) transaction synthétique DGI TEST acceptée, (d) facture/QR rapprochés sur le système de vérification DGI, (e) preuve persistée et référencée. Sinon statut explicite `BLOCKED`/`NOT VERIFIED`.

## Contradictions connues à traiter en priorité

- DGI test 17 : EV mixte A+C ; un précédent rapport du code indique le rejet des factures mixtes C.
- DGI tests 19 et 20 : export EV/EA avec E (TPS) ; un précédent rapport indique que le mapper export n'accepte que C.
- DGI test 11 : taxe de séjour ; tests 7/10/13/15 : taxe spécifique ; tests 8/9/10 : AIB. Ce sont des fonctionnalités distinctes du groupe F.
- DGI test 4 : quantités décimales ; attention aux contraintes de quantités du domaine Restaurants et aux arrondis XOF.

## Processus de livraison

Dans le dépôt local, conserver ces sources dans un emplacement documentaire gouverné par `AGENTS.md`, puis renseigner `../compliance-matrix/dgi-sfe-20-tests-matrix.csv` depuis le code réellement existant. Implémenter les écarts, vérifier par domaines, et produire une preuve réelle TEST par cas. Ne pas compter des tests Jest comme validation DGI. Ne pas déployer sur PRODUCTION ni mettre en cause une tentative REM SI. Git commits logiques et push ciblés après tests pertinents, conformément à la gouvernance du dépôt.

## Prudence

Les noms et descriptions des 20 tests sont retranscrits de l'annexe 2 du document fourni ; vérifier l'annexe originale (détails précis) avant de créer les jeux de données. L'approbation DGI reste une procédure officielle distincte des tests locaux et TEST.

## Réconciliation du 25 novembre 2026

Les 20 feuilles individuelles du DOCX ont été relues directement dans le OOXML;
les divergences du résumé restent ouvertes (spécification §18, C1/C2). Le registre
exécutable des exigences est désormais dans Fiscal Compliance :
`lambda/domains/fiscal-compliance/providers/benin-emecef/sfe-scenarios.ts`.
Le rapprochement exact d'un cas est distinct de la sélection de forme utilisée
pour le traitement automatique de documents commerciaux de quantités différentes.

Une lecture bornée par tenant des tentatives TEST existantes a trouvé cinq
confirmations DGI_TEST, quatre CREATED et un UNKNOWN_OUTCOME. Les cinq sources
confirmées examinées sont B, quantité 1, TTC 1000 XOF : elles ne constituent pas
cinq cas différents. La vérification web DGI du code
`TEST-PRXJ-LKWL-HYMQ-PXGO-MH5Z` / NIM `TS01002103` a retourné « Facture trouvée »,
HT 847, TVA 153, total 1000 et contenu QR identique à la preuve persistée.
La matrice distingue cette observation réelle du rapprochement de l'impression
Liass, du décodage indépendant du QR et du VISA DGI encore manquants. Aucune
ancienne tentative n'a été rejouée ni modifiée lors de cette réconciliation.

Sources officielles supplémentaires consultées en ligne le 25 novembre 2026
(sans remplacement des sources historiques ni prétention d'archivage local) :

- [CGI Bénin 2026, articles 291–293](https://apisiteweb.impots.bj/media/6adcbd46ab83b_B%C3%A9nin-Code%20G%C3%A9n%C3%A9ral%20des%20Imp%C3%B4ts%202026.pdf) :
  taxe de séjour par jour/nuit selon tarif; exclusion de la base TVA. Ce texte
  ne définit pas le mapping API e-MECeF du cas 11.
- [Rescrit DGI, lettre 2487 du 17 juillet 2024](https://rescrits.impots.bj/questionreponse.php?categorie=Retenue+%C3%A0+la+Source+%28RS%29&nature=IMPOTS+SUR+LE+REVENU&rescrit=Base+d%E2%80%99imposition+de+l%E2%80%99AIB+%E2%80%93+Taxe+de+s%C3%A9jour+et+contribution+sur+services+de+communications+%C3%A9lectroniques) :
  exclusion de la taxe de séjour de la base AIB.

Conséquence : le calcul existant de taxe spécifique avec TVA ne doit pas être
réutilisé aveuglément pour le cas 11. Le mapping fournisseur et le parcours
applicatif dédiés restent à établir; une simulation wire `taxSpecific` ne les
valide pas. Aucun agrément DGI ni conformité 20/20 n'est revendiqué.

Décisions Product Owner du 25 novembre 2026 : utiliser provisoirement les
quantités des feuilles individuelles sans effacer celles du résumé; traiter le
cas 06 comme un FA lié à une FV réellement confirmée, conserver « remboursement »
comme ambiguïté à soumettre à DGI. Le cas 11 dispose d'un composant typé et d'un
calcul partagé 2026 (500/1500/2500 XOF selon tarif, par jour/nuit documenté),
conservé dans la préparation locale avec exclusion des bases TVA/AIB. Son mapping
API reste explicitement bloqué; aucun montant commercial n'est réécrit et aucun
`taxSpecific` n'est généré. La matrice distingue ce progrès local d'une preuve DGI.

Blocage fournisseur supplémentaire vérifié : les confirmations TEST observées
portent un code formaté de 29 caractères (`TEST-…`), alors que la validation du
source d'avoir exige actuellement le code original brut de 24 caractères. Ne pas
retirer les séparateurs ni substituer un numéro commercial sans preuve du format
attendu par DGI. Le parcours de preuve source et la fiscalisation automatique des
avoirs restent à compléter; les tests simulés à référence de 24 caractères ne
prouvent pas l'acceptation de ces originaux TEST réels.
