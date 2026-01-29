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
      billingMode: BillingMode.PAY_PER_REQUEST, // Optimisation coût validée
      pointInTimeRecovery: true, // Recommandé pour un ERP (sécurité des données)
    });

    // On crée 8 GSIs génériques
    // Chaque index peut être utilisé pour n'importe quel besoin métier
    for (let i = 1; i <= 8; i++) {
      this.table.addGlobalSecondaryIndex({
        indexName: `GSI-${i}`, // On peut garder GSI-Account, etc., ou GSI-1
        partitionKey: { name: "pk", type: AttributeType.STRING }, // On réutilise la PK principale pour le Sharding
        sortKey: { name: `gsi${i}sk`, type: AttributeType.STRING },
        projectionType: ProjectionType.ALL,
      });
    }
  }
}
