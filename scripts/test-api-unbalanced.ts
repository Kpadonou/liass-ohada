const payload = {
  year: 2024,
  description: "Test erreur déséquilibre",
  lines: [
    { accountId: "52100000", debit: 100000, credit: 0 },
    { accountId: "40110000", debit: 0, credit: 90000 }, // Manque 10 000
  ],
};
// Exécute-le et vérifie que tu reçois une erreur 400 (ERROR_ENTRY_NOT_BALANCED)
