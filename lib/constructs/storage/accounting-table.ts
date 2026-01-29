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

    // GSI-Account
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Account",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiAccountSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-ThirdParty
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-ThirdParty",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiThirdPartySK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Journal
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Journal",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiJournalSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Reference
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Reference",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiReferenceSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Audit
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Audit",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiAuditSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Matching
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Matching",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiMatchingSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Project
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Project",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiProjectSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI-Email
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI-Email",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "gsiEmailSK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
