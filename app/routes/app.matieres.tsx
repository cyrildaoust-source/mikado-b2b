import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator, type LoaderFunctionArgs } from "react-router";
import { context, requireAdmin } from "../services/context.server";
import { listLibrary } from "../services/library.server";
import {
  LIBRARY_MAX_BYTES,
  LIBRARY_MAX_SIDE,
  groupLibrary,
  kvadratColour,
  matchLibrary,
  parseKvadratProduct,
  parseSwatchName,
  type LibraryEntry,
} from "../domain/library";

import { listZip, mimeOf, readZipEntry, zipImages } from "../domain/zip";

export const meta = () => [{ title: "Matières · Mikado Deco Pro" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const c = await context(request);
  requireAdmin(c);
  return { library: await listLibrary() };
}

type Pending = { key: string; file: File; preview: string; collection: string; colour: string; error?: string };

const API = "/app/matieres/api";

/** Photo ramenée à 1 200 px de côté au plus, en JPEG, avant l'envoi. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LIBRARY_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < LIBRARY_MAX_BYTES * 0.8 && ["image/jpeg", "image/webp"].includes(file.type))
    return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.86));
  if (!blob) throw Error("Photo illisible.");
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

async function post(body: FormData) {
  const r = await fetch(API, { method: "POST", body });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) throw Error(json.error || "Action impossible.");
  return json;
}

export default function Materials() {
  const { library } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [maker, setMaker] = useState("Kvadrat");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  // Des milliers de coloris : 120 par éditeur à la fois.
  const [shown, setShown] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [kvadrat, setKvadrat] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const makers = useMemo(() => [...new Set(library.map((m) => m.maker))], [library]);
  const groups = groupLibrary(query.trim() ? library.filter((m) => matchLibrary(m, query)) : library);

  function choose(input: File[]) {
    let files = input;
    for (const z of files.filter((f) => /\.zip$/i.test(f.name))) {
      const p = parseKvadratProduct(kvadrat);
      z.arrayBuffer()
        .then((b) => openZip(b, p?.number || "", p?.collection || ""))
        .catch((e) => setMessage({ tone: "error", text: e instanceof Error ? e.message : "Archive illisible." }));
    }
    files = files.filter((f) => !/\.zip$/i.test(f.name));
    if (!files.length) return;
    const images = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    setPending((cur) => [
      ...cur,
      ...images.map((file, i) => ({
        key: `${Date.now()}-${i}-${file.name}`,
        file,
        preview: URL.createObjectURL(file),
        ...parseSwatchName(file.name),
      })),
    ]);
    if (images.length < files.length)
      setMessage({ tone: "error", text: "Certains fichiers ne sont pas des photos JPEG, PNG ou WebP : ils sont ignorés." });
  }

  /** Photos d'un pack zip : collection saisie (ou lue dans le nom), coloris lu dans le nom. */
  async function openZip(buf: ArrayBuffer, product: string, collection: string) {
    const images = zipImages(listZip(buf)).slice(0, 300);
    if (!images.length) throw Error("L'archive ne contient aucune photo JPEG, PNG ou WebP.");
    const items: Pending[] = [];
    for (const [i, e] of images.entries()) {
      const name = e.name.split("/").pop() || e.name;
      const file = new File([await readZipEntry(buf, e)], name, { type: mimeOf(name) });
      const parsed = parseSwatchName(name);
      items.push({
        key: `${Date.now()}-z${i}-${name}`,
        file,
        preview: URL.createObjectURL(file),
        collection: collection || parsed.collection,
        colour: product ? kvadratColour(e.name, product) : parsed.colour,
      });
    }
    setPending((cur) => [...cur, ...items]);
    return items.length;
  }

  async function loadKvadrat() {
    const p = parseKvadratProduct(kvadrat);
    if (!p) {
      setMessage({ tone: "error", text: "Collez l'adresse de la fiche Kvadrat ou son numéro de produit (ex. 1000)." });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const r = await fetch(`/app/matieres/kvadrat/${p.number}`);
      if (!r.ok) throw Error((await r.text()) || "Pack d'images indisponible.");
      const n = await openZip(await r.arrayBuffer(), p.number, p.collection);
      setMaker("Kvadrat");
      setMessage({ tone: "ok", text: `${n} photo(s) chargée(s). Vérifiez la collection et le coloris, retirez les photos d'ambiance, puis ajoutez.` });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Pack d'images indisponible." });
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    setBusy(true);
    setMessage(null);
    setProgress(0);
    let done = 0;
    const failed: Pending[] = [];
    for (const p of pending) {
      try {
        const body = new FormData();
        body.set("intent", "add");
        body.set("maker", maker);
        body.set("collection", p.collection);
        body.set("colour", p.colour);
        body.set("file", await shrink(p.file));
        await post(body);
        URL.revokeObjectURL(p.preview);
        done++;
      } catch (e) {
        failed.push({ ...p, error: e instanceof Error ? e.message : "Envoi impossible." });
      }
      setProgress(done + failed.length);
    }
    setPending(failed);
    setBusy(false);
    setMessage(
      failed.length
        ? { tone: "error", text: `${done} matière(s) ajoutée(s), ${failed.length} en erreur : voir la liste.` }
        : { tone: "ok", text: `${done} matière(s) ajoutée(s) à la bibliothèque ${maker}.` },
    );
    revalidator.revalidate();
  }

  async function remove(ids: string[], label: string) {
    if (!window.confirm(`Retirer ${label} de la bibliothèque ? Elle disparaîtra aussi des mood boards.`)) return;
    const body = new FormData();
    body.set("intent", "delete");
    ids.forEach((id) => body.append("id", id));
    try {
      await post(body);
      setMessage({ tone: "ok", text: `${label} : retiré.` });
      revalidator.revalidate();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Retrait impossible." });
    }
  }

  async function save(m: LibraryEntry, form: HTMLFormElement) {
    const body = new FormData(form);
    body.set("intent", "update");
    body.set("id", m.id);
    try {
      await post(body);
      setEditing(null);
      revalidator.revalidate();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Enregistrement impossible." });
    }
  }

  return (
    <main className="workspace library-page">
      <header className="list-header">
        <div>
          <h1>Matières</h1>
          <p>
            Les tissus et matières que vous avez en magasin. Les architectes les retrouvent dans
            l'onglet Matières de leur mood board, avec la collection et le coloris en légende.
          </p>
        </div>
      </header>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "error" : "success"}>
          {message.text}
        </p>
      )}

      <section className="list-card library-import" aria-labelledby="library-kvadrat-title">
        <h2 id="library-kvadrat-title">Importer depuis Kvadrat</h2>
        <p className="muted">
          Collez l'adresse d'une fiche produit kvadrat.dk (ou son numéro). L'outil charge le pack d'images
          basse résolution que Kvadrat propose sur la fiche, puis vous montre la liste avant tout envoi.
        </p>
        <form
          className="library-import-row"
          onSubmit={(e) => {
            e.preventDefault();
            void loadKvadrat();
          }}
        >
          <label className="library-field library-field-wide">
            <span>Fiche Kvadrat</span>
            <input
              value={kvadrat}
              placeholder="https://www.kvadrat.dk/en/products/upholstery/1000-hallingdal-65"
              onChange={(e) => setKvadrat(e.target.value)}
            />
          </label>
          <button className="primary" disabled={loading || busy || !kvadrat.trim()}>
            {loading ? "Chargement…" : "Charger les photos"}
          </button>
        </form>
      </section>

      <section className="list-card library-import" aria-labelledby="library-import-title">
        <h2 id="library-import-title">Ajouter des photos</h2>
        <p className="muted">
          Choisissez un dossier, plusieurs photos ou un zip. Le nom du fichier donne la collection et le coloris,
          par exemple « Hallingdal 65 - 130.jpg ». Vérifiez la liste avant l'envoi. Une photo déjà présente
          (même éditeur, collection et coloris) est remplacée.
        </p>
        <div className="library-import-row">
          <label className="library-field">
            <span>Éditeur</span>
            <input list="library-makers" value={maker} onChange={(e) => setMaker(e.target.value)} />
            <datalist id="library-makers">
              {makers.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="button library-pick">
            Choisir des photos
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,.zip,application/zip"
              multiple
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                choose([...(e.target.files || [])]);
                e.target.value = "";
              }}
            />
          </label>
          <label className="button library-pick">
            Choisir un dossier
            <input
              type="file"
              multiple
              style={{ display: "none" }}
              disabled={busy}
              // @ts-expect-error attribut non standard, reconnu par Chrome, Safari et Firefox
              webkitdirectory=""
              onChange={(e) => {
                choose([...(e.target.files || [])]);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {pending.length > 0 && (
          <>
            <table className="quote-table library-table">
              <thead>
                <tr>
                  <th>
                    <span className="visually-hidden">Photo</span>
                  </th>
                  <th>Collection</th>
                  <th>Coloris</th>
                  <th>
                    <span className="visually-hidden">Retirer</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <img className="library-thumb" src={p.preview} alt="" />
                    </td>
                    <td>
                      <input
                        aria-label={`Collection de ${p.file.name}`}
                        value={p.collection}
                        onChange={(e) =>
                          setPending((cur) => cur.map((x) => (x.key === p.key ? { ...x, collection: e.target.value } : x)))
                        }
                      />
                      {p.error && <small className="library-error">{p.error}</small>}
                    </td>
                    <td>
                      <input
                        aria-label={`Coloris de ${p.file.name}`}
                        value={p.colour}
                        onChange={(e) =>
                          setPending((cur) => cur.map((x) => (x.key === p.key ? { ...x, colour: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          URL.revokeObjectURL(p.preview);
                          setPending((cur) => cur.filter((x) => x.key !== p.key));
                        }}
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="library-import-row">
              <button type="button" className="primary" disabled={busy || !maker.trim()} onClick={() => void send()}>
                {busy
                  ? `Envoi ${progress} / ${pending.length}…`
                  : `Ajouter ${pending.length} matière${pending.length > 1 ? "s" : ""} à ${maker || "…"}`}
              </button>
              <button
                type="button"
               
                disabled={busy}
                onClick={() => {
                  pending.forEach((p) => URL.revokeObjectURL(p.preview));
                  setPending([]);
                }}
              >
                Tout annuler
              </button>
            </div>
          </>
        )}
      </section>

      <section className="list-card" aria-labelledby="library-list-title">
        <div className="library-list-head">
          <h2 id="library-list-title">
            Bibliothèque <span className="muted">({library.length})</span>
          </h2>
          {library.length > 0 && (
            <input
              type="search"
              aria-label="Rechercher une matière"
              placeholder="Rechercher : Hallingdal 130"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
        {library.length === 0 ? (
          <p className="muted">
            La bibliothèque est vide. Ajoutez les photos de vos tissus Kvadrat pour qu'elles apparaissent
            dans les mood boards.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.maker} className="library-maker">
              <div className="library-list-head">
                <h3>
                  {g.maker} <span className="muted">({g.items.length})</span>
                </h3>
                {!query.trim() && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void remove(g.items.map((m) => m.id), `Toutes les matières ${g.maker}`)}
                  >
                    Tout retirer
                  </button>
                )}
              </div>
              <ul className="library-grid">
                {g.items.slice(0, shown[g.maker] || 120).map((m) => (
                  <li key={m.id}>
                    <img src={`/app/matieres/image/${m.id}?w=240`} alt="" loading="lazy" />
                    {editing === m.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void save(m, e.currentTarget);
                        }}
                      >
                        <input name="maker" aria-label="Éditeur" defaultValue={m.maker} />
                        <input name="collection" aria-label="Collection" defaultValue={m.collection} />
                        <input name="colour" aria-label="Coloris" defaultValue={m.colour} />
                        <div>
                          <button className="text-button">Enregistrer</button>
                          <button type="button" className="text-button" onClick={() => setEditing(null)}>
                            Annuler
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <strong>{m.collection}</strong>
                        <span className="muted">{m.colour || "—"}</span>
                        <div>
                          <button type="button" className="text-button" onClick={() => setEditing(m.id)}>
                            Modifier
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void remove([m.id], [m.collection, m.colour].filter(Boolean).join(" "))}
                          >
                            Retirer
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {g.items.length > (shown[g.maker] || 120) && (
                <button type="button" className="text-button" onClick={() => setShown((s) => ({ ...s, [g.maker]: (s[g.maker] || 120) + 120 }))}>
                  Afficher plus ({g.items.length - (shown[g.maker] || 120)} restants)
                </button>
              )}
            </div>
          ))
        )}
      </section>
    </main>
  );
}
