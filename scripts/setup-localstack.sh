#!/bin/bash

# Configuration
ENDPOINT="http://localhost:4566"
TABLE_NAME="liass-ohada-dev-accounting-table"
REGION="us-east-1"

echo "🚀 Starting LocalStack configuration..."

# 1. Cleanup
aws --endpoint-url=$ENDPOINT dynamodb delete-table --table-name $TABLE_NAME --region $REGION > /dev/null 2>&1

# 2. Table Creation
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
            }
        ]" \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5

echo "⏳ Waiting for table activation..."
aws --endpoint-url=$ENDPOINT dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION

# 3. Fiscal Year Injection
echo "📝 Injecting Fiscal Year 2026..."
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --region $REGION \
    --item '{
        "PK": {"S": "ORG#test-org-001"},
        "SK": {"S": "FY#2026"},
        "entityType": {"S": "FISCAL_YEAR"},
        "status": {"S": "OPEN"},
        "startDate": {"S": "2026-01-01"},
        "endDate": {"S": "2026-12-31"},
        "GSI1PK": {"S": "ORG#test-org-001"},
        "GSI1SK": {"S": "FY#2026"}
    }'

echo "✅ Environment Ready in $REGION!"