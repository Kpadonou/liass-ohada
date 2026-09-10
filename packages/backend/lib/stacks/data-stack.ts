import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { LiassOhadaAccountingTable } from "../constructs/storage/accounting-table";

interface DataStackProps extends StackProps {
  documentBucketName: string;
  tableName: string;
}

export class DataStack extends Stack {
  public readonly accountingTable: LiassOhadaAccountingTable;
  public readonly documentBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    this.accountingTable = new LiassOhadaAccountingTable(
      this,
      "AccountingTable",
      {
        tableName: props.tableName,
      },
    );

    this.documentBucket = new s3.Bucket(this, "PrivateDocumentBucket", {
      bucketName: props.documentBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });
  }
}
