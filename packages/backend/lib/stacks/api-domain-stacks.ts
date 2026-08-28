import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { DeploymentStage } from "../config/deployment";
import { AccountingEndpoints } from "../constructs/domains/accounting-endpoints";
import { IdentityEndpoints } from "../constructs/domains/identity-endpoints";
import { ProjectEndpoints } from "../constructs/domains/project-endpoints";
import { SalesEndpoints } from "../constructs/domains/sales-endpoints";
import { TreasuryEndpoints } from "../constructs/domains/treasury-endpoints";

interface ApiDomainStackProps extends NestedStackProps {
  api: apigwv2.HttpApi;
  authorizer?: apigwv2.IHttpRouteAuthorizer;
  lambdaRole: iam.IRole;
  stage: DeploymentStage;
  table: dynamodb.ITable;
}

export class IdentityApiStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiDomainStackProps) {
    super(scope, id, props);
    new IdentityEndpoints(this, "IdentityModule", props);
  }
}

export class AccountingApiStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiDomainStackProps) {
    super(scope, id, props);
    new AccountingEndpoints(this, "AccountingModule", props);
  }
}

export class ProjectApiStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiDomainStackProps) {
    super(scope, id, props);
    new ProjectEndpoints(this, "ProjectModule", props);
  }
}

export class TreasuryApiStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiDomainStackProps) {
    super(scope, id, props);
    new TreasuryEndpoints(this, "TreasuryModule", props);
  }
}

export class SalesApiStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ApiDomainStackProps) {
    super(scope, id, props);
    new SalesEndpoints(this, "SalesModule", props);
  }
}
