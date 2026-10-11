import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/** Reviewed LP-2 stateful owner; no speculative indexes, TTL or streams. */
export class RestaurantsTable extends Construct {
  public readonly table: Table;
  constructor(scope: Construct, id: string, props: { tableName: string }) {
    super(scope, id);
    this.table = new Table(this, "Table", {
      tableName: props.tableName,
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
