// scripts/seed-multi-projects.ts
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";

async function seed() {
  const orgId = "org-test-dash";
  const now = new Date().toISOString();

  const projects = [
    { id: "WASH-001", code: "WASH-2026", name: "Projet Eau", total: 10000000 },
    {
      id: "EDU-002",
      code: "EDU-2026",
      name: "Projet Éducation",
      total: 20000000,
    },
  ];

  for (const p of projects) {
    const item = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK(p.id),
      orgId: orgId, // Requis par Zod
      projectId: p.id,
      projectCode: p.code,
      name: p.name,
      donorId: "UNICEF", // Requis par Zod
      managerId: "USER-001", // Requis par Zod
      startDate: "2026-01-01", // Requis par Zod
      totalBudget: p.total,
      annualBudgets: { "2026": p.total / 2 },
      status: "ACTIVE",
      currency: "XOF", // Souvent requis
      createdAt: now, // Requis par Zod
      updatedAt: now, // Requis par Zod
      entityType: "PROJECT",
    };

    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(item),
      }),
    );
  }
  console.log("✅ Projets seedés avec tous les champs Zod.");
}
seed().catch(console.error);
