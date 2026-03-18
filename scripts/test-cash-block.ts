// scripts/test-cash-block.ts
import axios from "axios";

async function testInsufficientFunds() {
  console.log("🚀 Test de blocage : Dépense > Cash disponible...");

  const entry = {
    orgId: "org-test-dash",
    year: 2026,
    label: "Tentative achat matériel hors cash",
    lines: [
      {
        accountId: "60510000",
        debit: 400000, // Supérieur aux 300,000 restants
        projectId: "EDU-002",
        budgetLineId: "EQUIP-01",
        donorId: "UNICEF",
      },
      {
        accountId: "40110000", // Compte fournisseur pour équilibrer
        credit: 400000,
      },
    ],
  };

  try {
    // Remplace par ton URL Lambda locale si nécessaire
    await axios.post("http://localhost:3000/entries", entry);
    console.log("❌ Erreur : La transaction aurait dû être rejetée !");
  } catch (error: any) {
    console.log("✅ Succès : La transaction a été rejetée comme prévu.");
    console.log("Message d'erreur :", error.response?.data?.message);
  }
}

testInsufficientFunds();
