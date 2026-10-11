import { Duration } from "aws-cdk-lib";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface RestaurantsMigrationOperatorProps {
  sourceTable: ITable;
  destinationTable: ITable;
  trustedRoleArn: string;
}

/** Offline release capability; never used as a Restaurants Lambda role. */
export class RestaurantsMigrationOperator extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: RestaurantsMigrationOperatorProps) {
    super(scope, id);
    if (!/^arn:(aws|aws-us-gov|aws-cn):iam::\d{12}:role\/.+$/.test(props.trustedRoleArn)
      || props.trustedRoleArn.includes("*")) {
      throw new Error("Restaurants migration trust requires an explicit IAM role ARN");
    }
    if (props.sourceTable.tableArn === props.destinationTable.tableArn) {
      throw new Error("Restaurants migration source and destination must differ");
    }
    this.role = new iam.Role(this, "Role", {
      assumedBy: new iam.ArnPrincipal(props.trustedRoleArn),
      description: "Offline Restaurants migration: source inventory only, destination create and verify",
      maxSessionDuration: Duration.hours(1),
    });
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Scan"],
      resources: [props.sourceTable.tableArn],
    }));
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem"],
      resources: [props.destinationTable.tableArn],
    }));
    // GetItem/PutItem otherwise also authorize their transaction variants,
    // which the migration does not use.
    this.role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
      resources: [props.destinationTable.tableArn],
      conditions: {
        "ForAnyValue:StringEquals": {
          "dynamodb:EnclosingOperation": ["TransactWriteItems", "TransactGetItems"],
        },
      },
    }));
  }
}
