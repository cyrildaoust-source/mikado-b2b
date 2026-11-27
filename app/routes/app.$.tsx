// Adresse inconnue sous /app : l'écran d'erreur de l'outil, avec la barre du haut.
export async function loader() {
  // « Not Found » : l'écran d'erreur affiche alors son texte général.
  throw new Response("Not Found", { status: 404 });
}

export default function NotFound() {
  return null;
}
