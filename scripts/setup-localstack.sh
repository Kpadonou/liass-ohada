#!/bin/bash

# Configuration
ENDPOINT="http://localhost:4566"
TABLE_NAME="liass-ohada-dev-accounting-table"
REGION="us-east-1"

echo "🚀 Démarrage de la configuration complète de LocalStack..."

# 1. Nettoyage
echo "🗑️  Suppression de l'ancienne table..."
aws --endpoint-url=$ENDPOINT dynamodb delete-table --table-name $TABLE_NAME > /dev/null 2>&1

# 2. Création de la table avec 8 GSIs
echo "🏗️  Création de la table avec PK, SK et les 8 GSIs en MAJUSCULES..."
aws --endpoint-url=$ENDPOINT dynamodb create-table \
    --table-name $TABLE_NAME \
    --attribute-definitions \
        AttributeName=PK,AttributeType=S \
        AttributeName=SK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
        AttributeName=GSI2SK,AttributeType=S \
        AttributeName=GSI3SK,AttributeType=S \
        AttributeName=GSI4SK,AttributeType=S \
        AttributeName=GSI5SK,AttributeType=S \
        AttributeName=GSI6SK,AttributeType=S \
        AttributeName=GSI7SK,AttributeType=S \
        AttributeName=GSI8SK,AttributeType=S \
    --key-schema \
        AttributeName=PK,KeyType=HASH \
        AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
        "[
            {\"IndexName\": \"GSI-Account\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-ThirdParty\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI2SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-Journal\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI3SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-Reference\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI4SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-Audit\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI5SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-Matching\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI6SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-Project\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI7SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}},
            {\"IndexName\": \"GSI-Email\", \"KeySchema\": [{\"AttributeName\": \"PK\", \"KeyType\": \"HASH\"}, {\"AttributeName\": \"GSI8SK\", \"KeyType\": \"RANGE\"}], \"Projection\": {\"ProjectionType\": \"ALL\"}, \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}}
        ]" \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --region $REGION

echo "⏳ Attente de l'activation de la table..."
aws --endpoint-url=$ENDPOINT dynamodb wait table-exists --table-name $TABLE_NAME

# 3. Injection Exercice Fiscal 2024
echo "📝 Injection de l'exercice fiscal 2024..."
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item '{
        "PK": {"S": "ORG#test-org-001"},
        "SK": {"S": "FY#2024"},
        "entityType": {"S": "FISCAL_YEAR"},
        "status": {"S": "OPEN"},
        "startDate": {"S": "2024-01-01"},
        "endDate": {"S": "2024-12-31"}
    }'

echo "✅ Environnement LocalStack prêt avec 8 GSIs !"