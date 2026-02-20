#!/bin/bash

# Configuration
ENDPOINT="http://localhost:4566"
TABLE_NAME="liass-ohada-dev-accounting-table"
REGION="us-east-1"

echo "🚀 Starting LocalStack configuration for SYCEBNL..."

# 1. Cleanup
aws --endpoint-url=$ENDPOINT dynamodb delete-table --table-name $TABLE_NAME --region $REGION > /dev/null 2>&1

# 2. Table Creation
# Ajout de GSI4PK et GSI4SK pour le suivi des Projets (GSI4)
aws --endpoint-url=$ENDPOINT dynamodb create-table \
    --table-name $TABLE_NAME \
    --region $REGION \
    --attribute-definitions \
        AttributeName=PK,AttributeType=S \
        AttributeName=SK,AttributeType=S \
        AttributeName=GSI1PK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
        AttributeName=GSI2PK,AttributeType=S \
        AttributeName=GSI2SK,AttributeType=S \
        AttributeName=L_PK,AttributeType=S \
        AttributeName=L_SK,AttributeType=S \
        AttributeName=GSI4PK,AttributeType=S \
        AttributeName=GSI4SK,AttributeType=S \
    --key-schema \
        AttributeName=PK,KeyType=HASH \
        AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
        "[
            {
                \"IndexName\": \"GSI_ACCOUNT\",
                \"KeySchema\": [{\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}],
                \"Projection\": {\"ProjectionType\": \"ALL\"},
                \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
            },
            {
                \"IndexName\": \"GSI_THIRD_PARTY\",
                \"KeySchema\": [{\"AttributeName\": \"GSI2PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI2SK\", \"KeyType\": \"RANGE\"}],
                \"Projection\": {\"ProjectionType\": \"ALL\"},
                \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
            },
            {
                \"IndexName\": \"GSI_LETTERING\",
                \"KeySchema\": [{\"AttributeName\": \"L_PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"L_SK\", \"KeyType\": \"RANGE\"}],
                \"Projection\": {\"ProjectionType\": \"ALL\"},
                \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
            },
            {
                \"IndexName\": \"GSI_PROJECT\",
                \"KeySchema\": [{\"AttributeName\": \"GSI4PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI4SK\", \"KeyType\": \"RANGE\"}],
                \"Projection\": {\"ProjectionType\": \"ALL\"},
                \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
            }
        ]" \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5

echo "⏳ Waiting for table activation..."
aws --endpoint-url=$ENDPOINT dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION

# 3. Master Data Injection
echo "📝 Injecting Initial Data..."

# Fiscal Year
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --region $REGION \
    --item '{
        "PK": {"S": "ORG#test-org-001"},
        "SK": {"S": "FY#2026"},
        "orgId": {"S": "test-org-001"},
        "year": {"N": "2026"},
        "fiscalYearId": {"S": "FY-2026"},
        "entityType": {"S": "FISCAL_YEAR"},
        "status": {"S": "OPEN"},
        "accountingStandard": {"S": "SYSCOHADA_GENERAL"},
        "startDate": {"S": "2026-01-01"},
        "endDate": {"S": "2026-12-31"},
        "GSI1PK": {"S": "ORG#test-org-001"},
        "GSI1SK": {"S": "FY#2026"},
        "createdAt": {"S": "2026-01-01T00:00:00.000Z"},
        "updatedAt": {"S": "2026-01-01T00:00:00.000Z"}
    }'

# Organisation test en mode SYCEBNL (pour tes tests unitaires)
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --region $REGION \
    --item '{
        "PK": {"S": "ORG#test-org-sycebnl"},
        "SK": {"S": "ORG#test-org-sycebnl"},
        "orgId": {"S": "test-org-sycebnl"},
        "entityType": {"S": "ORGANIZATION"},
        "accountingStandard": {"S": "SYCEBNL"}
    }'

# Fiscal Year for test-org-sycebnl (required by post-entry validation)
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --region $REGION \
    --item '{
        "PK": {"S": "ORG#test-org-sycebnl"},
        "SK": {"S": "FY#2026"},
        "orgId": {"S": "test-org-sycebnl"},
        "year": {"N": "2026"},
        "fiscalYearId": {"S": "FY-2026"},
        "entityType": {"S": "FISCAL_YEAR"},
        "status": {"S": "OPEN"},
        "accountingStandard": {"S": "SYCEBNL"},
        "startDate": {"S": "2026-01-01"},
        "endDate": {"S": "2026-12-31"},
        "GSI1PK": {"S": "ORG#test-org-sycebnl"},
        "GSI1SK": {"S": "FY#2026"},
        "createdAt": {"S": "2026-01-01T00:00:00.000Z"},
        "updatedAt": {"S": "2026-01-01T00:00:00.000Z"}
    }'

# scripts/setup-localstack.sh

echo "Adding mandatory accounts for SYCEBNL test..."

# Compte Client (Tiers)
aws --endpoint-url=http://localhost:4566 dynamodb put-item \
    --table-name liass-ohada-dev-accounting-table \
    --item '{
        "PK": {"S": "ORG#test-org-sycebnl"},
        "SK": {"S": "ACC#41110000"},
        "accountId": {"S": "41110000"},
        "label": {"S": "Clients Collectifs"},
        "type": {"S": "ASSET"},
        "entityType": {"S": "ACCOUNT"}
    }'

# Compte de Revenus (Produits)
aws --endpoint-url=http://localhost:4566 dynamodb put-item \
    --table-name liass-ohada-dev-accounting-table \
    --item '{
        "PK": {"S": "ORG#test-org-sycebnl"},
        "SK": {"S": "ACC#75100000"},
        "accountId": {"S": "75100000"},
        "label": {"S": "Subventions d exploitation"},
        "type": {"S": "REVENUE"},
        "entityType": {"S": "ACCOUNT"}
    }'

# Compte de Trésorerie (Banque)
aws --endpoint-url=http://localhost:4566 dynamodb put-item \
    --table-name liass-ohada-dev-accounting-table \
    --item '{
        "PK": {"S": "ORG#test-org-sycebnl"},
        "SK": {"S": "ACC#52100000"},
        "accountId": {"S": "52100000"},
        "label": {"S": "Banque BOA"},
        "type": {"S": "ASSET"},
        "entityType": {"S": "ACCOUNT"}
    }'

echo "✅ Environment Ready with GSI_PROJECT (GSI4) index!"