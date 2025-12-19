const CATEGORIES = [
  "Nombre",
  "Ciudad/País",
  "Animal",
  "Fruta/Vegetal",
  "Color",
  "Cosa",
];

const FUN_CATEGORIES = [
  "Excusa para cortar con tu ex",
  "Insulto de señora",
  "Lo que gritarías en una montaña rusa",
  "Razón para llegar tarde",
  "Nombre de banda de rock mediocre",
  "Algo que no debes decir en un funeral",
  "Título de película porno bajo presupuesto",
  "Comida que te da diarrea",
  "Lugar donde no deberías despertar",
  "Regalo terrible para un niño",
];

// Combine standard with 2 random fun categories per game?
// Or just have a mix. Let's make a big pool.
// The user asked for "categories varied... plus rare but funny categories".
// Let's pick 5 standard and 2 funny per round? Or fixed per game?
// Simpler: Fixed set for the whole game, or maybe random per round?
// Classic Tuttifruti usually has fixed categories on the sheet.
// Let's generate a set of categories for the room when created.

function getRandomCategories() {
  const standard = [...CATEGORIES]; // Take all standard
  const fun = [...FUN_CATEGORIES].sort(() => 0.5 - Math.random()).slice(0, 3); // Take 3 random fun ones
  return [...standard, ...fun];
}

function getRandomLetter(exclude = []) {
  const alphabet = "ABCDEFGHIJLMNOPRSTUVZ"; // Removed difficult ones like K, W, X, Y, Q sometimes? Let's keep common ones.
  const available = alphabet.split("").filter((l) => !exclude.includes(l));
  if (available.length === 0) return "A"; // Fallback
  return available[Math.floor(Math.random() * available.length)];
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

module.exports = {
  getRandomCategories,
  getRandomLetter,
  generateRoomCode,
};
