import * as cdk from "aws-cdk-lib";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";

// Tes constructs existants
import { LiassOhadaApiGateway } from "../constructs/api/api-gateway";

// Nos nouveaux constructs de domaines
import { ProjectEndpoints } from "../constructs/domains/project-endpoints";
import { CoreLedgerEndpoints } from "../constructs/domains/core-ledger-endpoints";

/**
 * On définit des Props pour recevoir la table de la DataStack
 */
interface ApiStackProps extends StackProps {
  accountingTable: dynamodb.ITable;
}

export class ApiStack extends Stack {
  public readonly apiGateway: LiassOhadaApiGateway;
  public readonly httpApi: apigw.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // 1. Initialisation de l'Infrastructure de base
    // On crée l'API Gateway (HTTP API v2)
    this.apiGateway = new LiassOhadaApiGateway(this, "ApiGateway");

    // Auth construct is optional in this workspace; pass undefined authorizer to domain constructs
    // this.auth = new LiassOhadaAuth(this, "Auth");

    // -----------------------------------------------------------
    // 2. Initialisation des Domaines (Injection de Dépendances)
    // -----------------------------------------------------------

    // --- Domaine : Gestion de Projets (SYCEBNL) ---
    new ProjectEndpoints(this, "ProjectModule", {
      api: this.apiGateway.httpApi,
      authorizer: undefined as any,
      table: props.accountingTable,
    });

    // --- Domaine : Core Ledger (Comptabilité Générale) ---
    new CoreLedgerEndpoints(this, "LedgerModule", {
      api: this.apiGateway.httpApi,
      authorizer: undefined as any,
      table: props.accountingTable,
    });

    // À l'avenir, tu n'auras qu'à ajouter ici :
    // new CommercialDomain(this, "CommercialModule", { ... });
  }
}
