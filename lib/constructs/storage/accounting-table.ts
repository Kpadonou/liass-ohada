import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class LiassOhadaAccountingTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new Table(this, "LiassOhadaAccountingTable", {
      tableName: "liass-ohada-AccountingTable",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    // GSI-Account (gsi1)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Account",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-ThirdParty (gsi2)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-ThirdParty",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Journal (gsi3)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Journal",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI3SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Reference (gsi4)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Reference",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI4SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Audit (gsi5)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Audit",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI5SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Matching (gsi6)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Matching",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI6SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Project (gsi7)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Project",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI7SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Email (gsi8)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Email",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI8SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
