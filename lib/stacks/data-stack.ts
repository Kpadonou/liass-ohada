import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { LiassOhadaAccountingTable } from "../constructs/storage/accounting-table";

export class DataStack extends Stack {
  public readonly accountingTable: LiassOhadaAccountingTable;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.accountingTable = new LiassOhadaAccountingTable(
      this,
      "AccountingTable"
    );
  }
}
