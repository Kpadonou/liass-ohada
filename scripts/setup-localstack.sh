#!/bin/bash

# Configuration
ENDPOINT="http://localhost:4566"
TABLE_NAME="liass-ohada-dev-accounting-table"
REGION="us-east-1"
ORG_ID="org-test-dash"
NOW="2026-02-22T17:00:00.000Z"

echo "🚀 Starting LocalStack configuration for SYCEBNL (SaaS Mode)..."

# 1. Cleanup
echo "🗑️ Deleting existing table..."
aws --endpoint-url=$ENDPOINT dynamodb delete-table --table-name $TABLE_NAME --region $REGION > /dev/null 2>&1

# 2. Table Creation
echo "🏗️ Creating table with GSI4 (Project Ledger)..."
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

# 3. Master Data Injection (Zod-Compliant)
echo "📝 Injecting Organization & Fiscal Year..."

# Organisation Metadata
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"ORG#$ORG_ID\"},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"name\": {\"S\": \"ONG Démo SYCEBNL\"},
        \"entityType\": {\"S\": \"ORGANIZATION\"},
        \"accountingStandard\": {\"S\": \"SYCEBNL\"},
        \"status\": {\"S\": \"ACTIVE\"},
        \"currency\": {\"S\": \"XOF\"},
        \"createdAt\": {\"S\": \"$NOW\"},
        \"updatedAt\": {\"S\": \"$NOW\"}
    }"

# Fiscal Year 2026
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"FY#2026\"},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"year\": {\"N\": \"2026\"},
        \"fiscalYearId\": {\"S\": \"FY-2026\"},
        \"entityType\": {\"S\": \"FISCAL_YEAR\"},
        \"status\": {\"S\": \"OPEN\"},
        \"accountingStandard\": {\"S\": \"SYCEBNL\"},
        \"startDate\": {\"S\": \"2026-01-01\"},
        \"endDate\": {\"S\": \"2026-12-31\"},
        \"GSI1PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"GSI1SK\": {\"S\": \"FY#2026\"},
        \"createdAt\": {\"S\": \"$NOW\"},
        \"updatedAt\": {\"S\": \"$NOW\"}
    }"

echo "📂 Injecting Mandatory Accounts..."

# Compte Client
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"ACC#41110000\"},
        \"accountId\": {\"S\": \"41110000\"},
        \"label\": {\"S\": \"Clients Collectifs\"},
        \"type\": {\"S\": \"ASSET\"},
        \"entityType\": {\"S\": \"ACCOUNT\"},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"createdAt\": {\"S\": \"$NOW\"}
    }"

# Compte de Revenus
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"ACC#75100000\"},
        \"accountId\": {\"S\": \"75100000\"},
        \"label\": {\"S\": \"Subventions d exploitation\"},
        \"type\": {\"S\": \"REVENUE\"},
        \"entityType\": {\"S\": \"ACCOUNT\"},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"createdAt\": {\"S\": \"$NOW\"}
    }"

# Compte Banque
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"ACC#52100000\"},
        \"accountId\": {\"S\": \"52100000\"},
        \"label\": {\"S\": \"Banque BOA\"},
        \"type\": {\"S\": \"ASSET\"},
        \"entityType\": {\"S\": \"ACCOUNT\"},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"createdAt\": {\"S\": \"$NOW\"}
    }"

# Compte de Charges (Fournitures)
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"ACC#60510000\"},
        \"accountId\": {\"S\": \"60510000\"},
        \"label\": {\"S\": \"Fournitures scolaires\"},
        \"type\": {\"S\": \"EXPENSE\"},
        \"entityType\": {\"S\": \"ACCOUNT\"},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"createdAt\": {\"S\": \"$NOW\"}
    }"

echo "🏗️ Injecting Project EDU-002..."
# Projet EDU-002
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item "{
        \"PK\": {\"S\": \"ORG#$ORG_ID\"},
        \"SK\": {\"S\": \"PRJ#EDU-002\"},
        \"projectId\": {\"S\": \"EDU-002\"},
        \"projectCode\": {\"S\": \"EDU-2026\"},
        \"name\": {\"S\": \"Projet Éducation Pour Tous\"},
        \"donorId\": {\"S\": \"WORLD-BANK\"},
        \"managerId\": {\"S\": \"USR-001\"},           # <--- AJOUTÉ
        \"startDate\": {\"S\": \"2026-01-01\"},       # <--- AJOUTÉ
        \"entityType\": {\"S\": \"PROJECT\"},
        \"status\": {\"S\": \"ACTIVE\"},
        \"totalBudget\": {\"N\": \"20000000\"},
        \"annualBudgets\": {\"M\": {\"2026\": {\"N\": \"8000000\"}}},
        \"orgId\": {\"S\": \"$ORG_ID\"},
        \"createdAt\": {\"S\": \"$NOW\"},
        \"updatedAt\": {\"S\": \"$NOW\"}              # <--- AJOUTÉ
    }"

echo "✅ Environment Ready for $ORG_ID!"