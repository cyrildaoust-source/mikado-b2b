import { ACCESS_NOTE, type Models3d } from "../../domain/models3d";

/** « Modèles 3D » de la fiche : fichiers du produit, page de la marque ou bibliothèque. */
export function Models3dBlock({ models, title }: { models: Models3d; title: string }) {
  const link = { target: "_blank", rel: "noreferrer noopener" } as const;
  return (
    <section className="product-models" aria-label="Modèles 3D">
      <h2>Modèles 3D</h2>
      {models.files.length > 0 && (
        <ul>
          {models.files.map((f) => (
            <li key={f.url}>
              <a className="button" href={f.url} {...link} download>
                Télécharger {f.format}
              </a>
            </li>
          ))}
        </ul>
      )}
      {models.files.length === 0 && models.page && (
        <p>
          <a className="button" href={models.page} {...link}>
            Télécharger le modèle 3D
          </a>
          <span className="muted">Sur le site de la marque, page de {title}.</span>
        </p>
      )}
      {models.library && (
        <p>
          {models.library.access === "dealer_login" ? (
            <span>
              {models.library.vendor} réserve ses fichiers 3D aux revendeurs. Demandez-nous le
              modèle de {title} : nous vous l'envoyons.
            </span>
          ) : (
            <>
              <a className="button" href={models.library.url} {...link}>
                Bibliothèque 3D {models.library.vendor}
              </a>
              <span className="muted">
                {models.library.formats.length ? `${models.library.formats.join(", ")}. ` : ""}
                Cherchez « {title} ». {ACCESS_NOTE[models.library.access]}
              </span>
            </>
          )}
        </p>
      )}
    </section>
  );
}
