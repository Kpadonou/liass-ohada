import { config } from "@/lambda/shared/config";
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
      tableName: config.TABLE_NAME,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    // GSI_ACCOUNT (gsi1)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI_ACCOUNT",
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI2 - Third Party Auxiliary Index
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI_THIRD_PARTY",
      partitionKey: { name: "GSI2PK", type: AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI3 - Lettering Sparse Index
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI_LETTERING",
      partitionKey: { name: "L_PK", type: AttributeType.STRING },
      sortKey: { name: "L_SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
