#!/bin/bash

# ==============================================================================
# Script de Réorganisation du Domaine Core-Ledger
# Objectif : Passer d'une structure technique à une structure pilotée par le domaine (DDD)
# ==============================================================================

# Sécurité : s'assurer que le script s'arrête en cas d'erreur
set -e

echo "🚀 Début de la réorganisation de core-ledger..."

# Vérification de l'emplacement
if [ ! -d "lambda/domains/core-ledger" ]; then
    echo "❌ Erreur : Dossier 'lambda/domains/core-ledger' non trouvé."
    echo "Assurez-vous d'exécuter ce script à la racine du projet backend."
    exit 1
fi

cd lambda/domains/core-ledger/

# 1. Création de la nouvelle arborescence
echo "📂 Création des nouveaux répertoires..."
mkdir -p lettering books analytics

# 2. Migration du domaine : LETTRAGE (Lettering)
echo "🔗 Migration du module Lettrage..."
[ -f "transactions/post-lettering.ts" ] && mv transactions/post-lettering.ts lettering/post-lettering.ts
[ -f "queries/get-lettering-suggestions.ts" ] && mv queries/get-lettering-suggestions.ts lettering/get-suggestions.ts
[ -f "entries/un-lettering.ts" ] && mv entries/un-lettering.ts lettering/cancel-lettering.ts

# 3. Migration du domaine : ÉTATS COMPTABLES (Books)
echo "📖 Migration des Livres et Balances..."
[ -f "ledger/get-account-ledger.ts" ] && mv ledger/get-account-ledger.ts books/get-general-ledger.ts
[ -f "queries/get-auxiliary-ledger.ts" ] && mv queries/get-auxiliary-ledger.ts books/get-auxiliary-ledger.ts
[ -f "queries/get-third-party-ledger.ts" ] && mv queries/get-third-party-ledger.ts books/get-third-party-ledger.ts
[ -f "reports/get-trial-balance.ts" ] && mv reports/get-trial-balance.ts books/get-trial-balance.ts

# 4. Migration du domaine : EXERCICE FISCAL (Fiscal Year)
echo "📅 Mise à jour du module Fiscal Year..."
[ -f "reports/post-year-end-closing.ts" ] && mv reports/post-year-end-closing.ts fiscal-year/close-year.ts

# 5. Migration du domaine : ANALYTICS
echo "📊 Migration des rapports de performance..."
[ -f "reports/get-income-statement.ts" ] && mv reports/get-income-statement.ts analytics/get-income-statement.ts

# 6. Nettoyage
echo "🧹 Nettoyage des anciens dossiers vides..."
find transactions queries ledger reports -type d -empty -delete 2>/dev/null || true

echo "✅ Réorganisation terminée avec succès !"
echo "⚠️  N'oubliez pas de lancer la consigne Copilot pour corriger les imports et le CDK."