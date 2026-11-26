/**
 * Petit cache en mémoire pour les lectures Shopify qui changent rarement
 * (réglages de la boutique, marques et familles). Il vit le temps d'une
 * instance serveur ; une erreur n'est pas gardée.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function memo<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now(),
    hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: now, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  if (store.size > 200) store.delete(store.keys().next().value!);
  return value;
}
