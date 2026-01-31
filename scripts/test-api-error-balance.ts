import axios from "axios";

const payload = {
  year: 2024,
  entryDate: "2024-03-20",
  description: "Test Erreur Equilibre",
  lines: [
    { accountId: "52100000", debit: 100000, credit: 0 },
    { accountId: "40110000", debit: 0, credit: 95000 }, // Déséquilibre de 5000
  ],
};

async function test() {
  try {
    const resp = await axios.post(
      "http://localhost:4566/restapis/.../prod/_user_request_/entries",
      payload
    );
    console.log("❌ Erreur : L'API a accepté une écriture déséquilibrée !");
  } catch (error: any) {
    console.log("✅ Succès du test : L'API a rejeté l'écriture.");
    console.log("Message reçu :", error.response?.data?.message?.code);
  }
}
test();
