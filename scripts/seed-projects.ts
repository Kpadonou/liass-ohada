import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";

/**
 * Seed script to create Zod-compliant projects.
 * Matches the 'org-test-dash' organization created in the bash script.
 */
async function seed() {
  const orgId = "org-test-dash";
  const now = new Date().toISOString();

  const projects = [
    {
      id: "WASH-001",
      code: "WASH-2026",
      name: "Projet Eau et Assainissement",
      total: 10000000,
      annual: 5000000,
      donor: "UNICEF",
    },
    {
      id: "EDU-002",
      code: "EDU-2026",
      name: "Projet Éducation Pour Tous",
      total: 20000000,
      annual: 8000000,
      donor: "WORLD-BANK",
    },
  ];

  console.log("--- 🏗️ Seeding Projects (Zod-Compliant Version) ---");

  for (const p of projects) {
    const item = {
      // Keys from KeyFactory
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK(p.id),

      // Mandatory Identification
      orgId: orgId,
      projectId: p.id,
      projectCode: p.code,
      name: p.name,
      donorId: p.donor,
      managerId: "USER-999", // Required by Zod

      // Dates & Status
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "ACTIVE",

      // Financial Data
      totalBudget: p.total,
      annualBudgets: {
        "2026": p.annual,
      },
      currency: "XOF",

      // Metadata
      entityType: "PROJECT",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item),
        }),
      );
      console.log(`✅ Project ${p.id} successfully seeded.`);
    } catch (error) {
      console.error(`❌ Failed to seed project ${p.id}:`, error);
    }
  }
}

seed().catch(console.error);
