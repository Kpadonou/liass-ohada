import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

interface LiassOhadaAccountingTableProps {
  tableName: string;
}

export class LiassOhadaAccountingTable extends Construct {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: LiassOhadaAccountingTableProps) {
    super(scope, id);

    this.table = new Table(this, "LiassOhadaAccountingTable", {
      tableName: props.tableName,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    // GSI1 - General Ledger (Account focus)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI2 - Third Party Auxiliary Index
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI3 - Lettering Sparse Index
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI3",
      partitionKey: { name: "GSI3PK", type: AttributeType.STRING },
      sortKey: { name: "GSI3SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI4 - Project Index (SYCEBNL)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI4",
      partitionKey: { name: "GSI4PK", type: AttributeType.STRING },
      sortKey: { name: "GSI4SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI5 - Journal/Audit Trail (Chronological)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI5",
      partitionKey: { name: "GSI5PK", type: AttributeType.STRING },
      sortKey: { name: "GSI5SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI6 - User Workspace Discovery (pre-tenant selection)
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI6",
      partitionKey: { name: "GSI6PK", type: AttributeType.STRING },
      sortKey: { name: "GSI6SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
