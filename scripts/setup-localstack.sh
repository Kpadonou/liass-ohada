#!/bin/bash

# Configuration
ENDPOINT="http://localhost:4566"
TABLE_NAME="liass-ohada-dev-accounting-table"
REGION="us-east-1"

echo "🚀 Starting full LocalStack configuration..."

# 1. Cleanup
echo "🗑️  Deleting old table..."
aws --endpoint-url=$ENDPOINT dynamodb delete-table --table-name $TABLE_NAME > /dev/null 2>&1

# 2. Table Creation
# We added GSI1PK to attribute definitions to support the Global GSI strategy.
echo "🏗️  Creating table with Global GSI support..."
aws --endpoint-url=$ENDPOINT dynamodb create-table \
    --table-name $TABLE_NAME \
    --attribute-definitions \
        AttributeName=PK,AttributeType=S \
        AttributeName=SK,AttributeType=S \
        AttributeName=GSI1PK,AttributeType=S \
        AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
        AttributeName=PK,KeyType=HASH \
        AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
        "[
            {
                \"IndexName\": \"GSI-Account\",
                \"KeySchema\": [
                    {\"AttributeName\": \"GSI1PK\", \"KeyType\": \"HASH\"},
                    {\"AttributeName\": \"GSI1SK\", \"KeyType\": \"RANGE\"}
                ],
                \"Projection\": {\"ProjectionType\": \"ALL\"},
                \"ProvisionedThroughput\": {\"ReadCapacityUnits\": 5, \"WriteCapacityUnits\": 5}
            }
        ]" \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --region $REGION

# Note: We only re-implemented GSI-Account (GSI1) for now to keep it lean. 
# You can add GSI2, GSI3 later following the same GSI1PK pattern if needed.

echo "⏳ Waiting for table activation..."
aws --endpoint-url=$ENDPOINT dynamodb wait table-exists --table-name $TABLE_NAME

# 3. Fiscal Year Injection (Master Data at Org Level)
echo "📝 Injecting Fiscal Year 2024..."
aws --endpoint-url=$ENDPOINT dynamodb put-item \
    --table-name $TABLE_NAME \
    --item '{
        "PK": {"S": "ORG#test-org-001"},
        "SK": {"S": "FY#2024"},
        "entityType": {"S": "FISCAL_YEAR"},
        "status": {"S": "OPEN"},
        "startDate": {"S": "2024-01-01"},
        "endDate": {"S": "2024-12-31"},
        "GSI1PK": {"S": "ORG#test-org-001"},
        "GSI1SK": {"S": "FY#2024"}
    }'

echo "✅ LocalStack environment ready with Global GSI strategy!"