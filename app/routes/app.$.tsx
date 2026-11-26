// Adresse inconnue sous /app : l'écran d'erreur de l'outil, avec la barre du haut.
export async function loader() {
  throw new Response("Introuvable", { status: 404 });
}

export default function NotFound() {
  return null;
}
