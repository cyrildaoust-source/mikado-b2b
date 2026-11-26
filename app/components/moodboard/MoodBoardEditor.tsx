import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Breadcrumb } from "../Breadcrumb";
import { BoardView } from "./BoardView";
import {
  BACKGROUNDS,
  BOARD_RATIO,
  TEXT_STYLES,
  WHOLE_PROJECT,
  autoLayout,
  isDark,
  keepInside,
  newId,
  photoHeight,
  resize,
  sized,
  type Board,
  type BoardItem,
  type BoardSection,
  type MoodState,
  type PaletteItem,
  type TextStyle,
} from "../../domain/moodboard";

type Upload = { id: string; name: string; width: number; height: number };
type Props = {
  id: number;
  number: string;
  project: string;
  client: string;
  sections: BoardSection[];
  mood: MoodState;
  uploads: Upload[];
};
type Gesture = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  item: BoardItem;
  rect: DOMRect;
  moved: boolean;
  wasSelected: boolean;
  snapshot: Board[];
};

const TAGS: Record<PaletteItem["tag"], string> = {
  produit: "Produit",
  alternative: "Alternative",
  option: "Option",
  ambiance: "Ambiance",
  ajout: "Ajoutée",
};
const INKS = ["#16181a", "#5f5d58", "#8a6a3d", "#ffffff"];
const MAX_SIDE = 2000;

/** Nouveau fond : les textes aux couleurs par défaut restent lisibles. */
const SWAP: Record<string, string> = {
  "#16181a": "#ffffff",
  "#ffffff": "#16181a",
  "#5f5d58": "#d6d3cc",
  "#d6d3cc": "#5f5d58",
};
function withBackground(b: Board, background: string): Board {
  if (isDark(b.background) === isDark(background)) return { ...b, background };
  return {
    ...b,
    background,
    items: b.items.map((i) =>
      i.kind === "text" && SWAP[i.color] ? { ...i, color: SWAP[i.color] } : i,
    ),
  };
}

export function MoodBoardEditor({
  id,
  number,
  project,
  client,
  sections,
  mood,
  uploads: initialUploads,
}: Props) {
  const [boards, setBoards] = useState<Board[]>(mood.boards);
  const [key, setKey] = useState(sections[0]?.key || "");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [past, setPast] = useState<Board[][]>([]);
  const [future, setFuture] = useState<Board[][]>([]);
  const [uploads, setUploads] = useState(initialUploads);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const ratios = useRef(new Map<string, number>());
  const fileInput = useRef<HTMLInputElement>(null);

  const section = sections.find((s) => s.key === key);
  const board = boards.find((b) => b.key === key) || { key, background: "#ffffff", items: [] };
  const item = board.items.find((i) => i.id === selected) || null;

  const resolve = useCallback(
    (src: string) =>
      src.startsWith("upload:")
        ? `/app/quotes/${id}/moodboard/image/${src.slice(7)}`
        : sized(src, 1200),
    [id],
  );

  // ——— Enregistrement : une seule requête à la fois, la dernière planche gagne.
  const latest = useRef(boards);
  const dirty = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const sendSave = useCallback(async () => {
    while (dirty.current) {
      dirty.current = false;
      setStatus("saving");
      const body = new FormData();
      body.set("intent", "save");
      body.set("state", JSON.stringify({ boards: latest.current }));
      try {
        const r = await fetch(`/app/quotes/${id}/moodboard/api`, { method: "POST", body });
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(json.error || "Enregistrement impossible.");
      } catch (e) {
        dirty.current = true;
        setStatus("error");
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "Enregistrement impossible." });
        return;
      }
    }
    setStatus("saved");
  }, [id]);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    if (dirty.current) {
      inflight.current = sendSave().finally(() => (inflight.current = null));
      await inflight.current;
    }
  }, [sendSave]);
  const scheduleSave = useCallback(
    (next: Board[]) => {
      latest.current = next;
      dirty.current = true;
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || inflight.current) e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  /** Change les planches : avec historique (annuler) et enregistrement. */
  const commit = useCallback(
    (next: Board[], snapshot?: Board[]) => {
      setPast((p) => [...p.slice(-49), snapshot || latest.current]);
      setFuture([]);
      setBoards(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );
  const updateBoard = (fn: (b: Board) => Board) => {
    const exists = boards.some((b) => b.key === key);
    const next = exists
      ? boards.map((b) => (b.key === key ? fn(b) : b))
      : [...boards, fn(board)];
    commit(next);
  };
  const updateItem = (itemId: string, patch: Partial<BoardItem>) =>
    updateBoard((b) => ({
      ...b,
      items: b.items.map((i) => (i.id === itemId ? ({ ...i, ...patch } as BoardItem) : i)),
    }));

  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [boards, ...f]);
    setBoards(prev);
    scheduleSave(prev);
    setSelected(null);
    setEditing(null);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast((p) => [...p, boards]);
    setBoards(next);
    scheduleSave(next);
  };

  // ——— Proportions des photos, mesurées une fois.
  const measure = useCallback(
    (src: string) =>
      new Promise<number>((done) => {
        const known = ratios.current.get(src);
        if (known) return done(known);
        if (src.startsWith("upload:")) {
          const u = uploads.find((x) => `upload:${x.id}` === src);
          if (u) {
            const r = u.width / u.height;
            ratios.current.set(src, r);
            return done(r);
          }
        }
        const img = new Image();
        img.onload = () => {
          const r = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
          ratios.current.set(src, r);
          done(r);
        };
        img.onerror = () => done(1);
        img.src = resolve(src);
      }),
    [resolve, uploads],
  );

  const layoutFor = useCallback(
    async (s: BoardSection, background = "#ffffff") => {
      // Produits retenus et options d'abord ; à défaut, les photos d'ambiance.
      let pick = s.photos.filter((p) => p.tag === "produit" || p.tag === "option");
      if (!pick.length) pick = s.photos.slice(0, 6);
      const photos = await Promise.all(
        pick.map(async (p) => ({ src: p.src, alt: p.alt, ratio: await measure(p.src) })),
      );
      return autoLayout(
        s.key,
        s.key === WHOLE_PROJECT ? project : s.title,
        s.key === WHOLE_PROJECT ? client : project,
        photos,
        background,
      );
    },
    [measure, project, client],
  );

  // Première visite : chaque pièce reçoit sa planche disposée automatiquement.
  useEffect(() => {
    const missing = sections.filter((s) => !mood.boards.some((b) => b.key === s.key));
    if (!missing.length) return;
    let alive = true;
    void Promise.all(missing.map((s) => layoutFor(s))).then((made) => {
      if (!alive) return;
      setBoards((cur) => {
        const next = [...cur, ...made.filter((m) => !cur.some((b) => b.key === m.key))];
        scheduleSave(next);
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // Une seule fois, à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ——— Ajouts
  const place = (w: number, h: number, at?: { x: number; y: number }) => {
    if (at) return { x: at.x - w / 2, y: at.y - h / 2 };
    const n = board.items.length % 8;
    return { x: 0.5 - w / 2 + (n - 4) * 0.02, y: 0.5 - h / 2 + (n - 4) * 0.02 };
  };
  const addItem = (made: BoardItem) => {
    const it = keepInside(made);
    updateBoard((b) => ({ ...b, items: [...b.items, it] }));
    setSelected(it.id);
    return it;
  };
  const addPhoto = async (p: { src: string; alt: string }, at?: { x: number; y: number }) => {
    const ratio = await measure(p.src);
    let w = 0.24,
      h = photoHeight(w, ratio);
    if (h > 0.55) {
      h = 0.55;
      w = (h * ratio) / BOARD_RATIO;
    }
    addItem({ id: newId(), kind: "photo", src: p.src, alt: p.alt, ratio, w, h, ...place(w, h, at) });
  };
  const addText = () => {
    const it = addItem({
      id: newId(),
      kind: "text",
      text: "Votre texte",
      style: "body",
      color: isDark(board.background) ? "#ffffff" : "#16181a",
      align: "left",
      w: 0.3,
      h: 0.08,
      ...place(0.3, 0.08),
    });
    setEditing(it.id);
  };
  const addColor = () =>
    addItem({
      id: newId(),
      kind: "color",
      color: "#c9b79c",
      label: "",
      w: 0.08,
      h: 0.08 * BOARD_RATIO,
      ...place(0.08, 0.08 * BOARD_RATIO),
    });

  const removeSelected = () => {
    if (!selected) return;
    updateBoard((b) => ({ ...b, items: b.items.filter((i) => i.id !== selected) }));
    setSelected(null);
    setEditing(null);
  };
  const reorder = (front: boolean) => {
    if (!item) return;
    updateBoard((b) => {
      const rest = b.items.filter((i) => i.id !== item.id);
      return { ...b, items: front ? [...rest, item] : [item, ...rest] };
    });
  };
  const duplicate = () => {
    if (!item) return;
    addItem({ ...item, id: newId(), x: item.x + 0.02, y: item.y + 0.03 });
  };
  const relayout = async () => {
    if (!section) return;
    const made = await layoutFor(section, board.background);
    updateBoard(() => made);
    setSelected(null);
  };

  // ——— Glisser dans la planche (souris, doigt, stylet)
  const onItemDown = (e: ReactPointerEvent, it: BoardItem, mode: Gesture["mode"]) => {
    if (editing === it.id && mode === "move") return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = boardRef.current!.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = {
      id: it.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      item: it,
      rect,
      moved: false,
      wasSelected: selected === it.id,
      snapshot: boards,
    };
    setSelected(it.id);
    if (editing && editing !== it.id) setEditing(null);
  };
  const onItemMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = (e.clientX - g.startX) / g.rect.width,
      dy = (e.clientY - g.startY) / g.rect.height;
    if (!g.moved && Math.abs(e.clientX - g.startX) + Math.abs(e.clientY - g.startY) < 4) return;
    g.moved = true;
    const next =
      g.mode === "move"
        ? keepInside({ ...g.item, x: g.item.x + dx, y: g.item.y + dy })
        : resize(g.item, g.item.w + dx, g.item.h + dy);
    setBoards((cur) =>
      cur.map((b) =>
        b.key === key ? { ...b, items: b.items.map((i) => (i.id === g.id ? next : i)) } : b,
      ),
    );
  };
  const onItemUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.moved) {
      setBoards((cur) => {
        setPast((p) => [...p.slice(-49), g.snapshot]);
        setFuture([]);
        scheduleSave(cur);
        return cur;
      });
    } else if (g.wasSelected && g.item.kind === "text") setEditing(g.id);
  };

  // Clavier : flèches, Suppr, Annuler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || !item) return;
      if (e.key === "Escape") {
        setSelected(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
        return;
      }
      const step = e.shiftKey ? 0.05 : 0.005;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step * BOARD_RATIO],
        ArrowDown: [0, step * BOARD_RATIO],
      };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      const moved = keepInside({ ...item, x: item.x + m[0], y: item.y + m[1] });
      updateItem(item.id, { x: moved.x, y: moved.y });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // ——— Photos glissées depuis la colonne (ordinateur) ou des fichiers déposés
  const boardPoint = (e: React.DragEvent) => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const at = boardPoint(e);
    const raw = e.dataTransfer.getData("application/x-mood-photo");
    if (raw) {
      void addPhoto(JSON.parse(raw), at);
      return;
    }
    if (e.dataTransfer.files.length) void upload([...e.dataTransfer.files], at);
  };

  // ——— Photos ajoutées par l'architecte
  async function shrink(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const png = file.type === "image/png";
    if (scale === 1 && file.size < 2_500_000 && ["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = png ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.86));
    if (!blob) throw Error("Photo illisible.");
    return new File([blob], file.name.replace(/\.\w+$/, png ? ".png" : ".jpg"), { type });
  }
  async function upload(files: File[], at?: { x: number; y: number }) {
    setBusy("upload");
    setMessage(null);
    try {
      for (const f of files.filter((f) => f.type.startsWith("image/"))) {
        const body = new FormData();
        body.set("intent", "upload");
        body.set("file", await shrink(f));
        const r = await fetch(`/app/quotes/${id}/moodboard/api`, { method: "POST", body });
        const json = await r.json().catch(() => ({}));
        if (!r.ok || !json.upload) throw Error(json.error || "Envoi impossible.");
        const u = json.upload as Upload;
        ratios.current.set(`upload:${u.id}`, u.width / u.height);
        setUploads((cur) => [...cur, u]);
        await addPhoto({ src: `upload:${u.id}`, alt: u.name }, at);
      }
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Envoi impossible." });
    } finally {
      setBusy(null);
    }
  }
  async function removeUpload(u: Upload) {
    setConfirmDelete(null);
    await flush();
    const body = new FormData();
    body.set("intent", "delete-upload");
    body.set("upload", u.id);
    const r = await fetch(`/app/quotes/${id}/moodboard/api`, { method: "POST", body });
    if (!r.ok) {
      setMessage({ tone: "error", text: "Suppression impossible." });
      return;
    }
    const src = `upload:${u.id}`;
    setUploads((cur) => cur.filter((x) => x.id !== u.id));
    // Le serveur a déjà retiré la photo des planches.
    const next = boards.map((b) => ({
      ...b,
      items: b.items.filter((i) => !(i.kind === "photo" && i.src === src)),
    }));
    setBoards(next);
    latest.current = next;
    setPast([]);
    setFuture([]);
  }

  // ——— Exports
  async function download(format: "pptx" | "pdf" | "png", only?: string) {
    setBusy(format);
    setMessage(null);
    try {
      await flush();
      if (dirty.current) throw Error("Enregistrez d'abord la planche.");
      const params = new URLSearchParams({ format });
      if (only) params.set("board", only);
      const r = await fetch(`/app/quotes/${id}/moodboard/export?${params}`);
      if (!r.ok) throw Error(r.status === 404 ? "La planche est vide." : (await r.text()) || "Export impossible.");
      const blob = await r.blob();
      const name =
        /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] ||
        `mood-board.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setMessage({ tone: "ok", text: `${name} est téléchargé.` });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Export impossible." });
    } finally {
      setBusy(null);
    }
  }

  const palette: PaletteItem[] = [
    ...(section?.photos || []),
    ...uploads.map((u) => ({ src: `upload:${u.id}`, alt: u.name || "Photo ajoutée", tag: "ajout" as const })),
  ];

  const renderItem = (it: BoardItem, content: ReactNode, style: CSSProperties) => {
    const isSel = it.id === selected;
    const isEditing = it.id === editing && it.kind === "text";
    return (
      <div
        key={it.id}
        style={style}
        className={`mood-item mood-${it.kind}${isSel ? " selected" : ""}${isEditing ? " editing" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={
          it.kind === "photo" ? `Photo ${it.alt}` : it.kind === "text" ? `Texte ${it.text}` : `Couleur ${it.label || it.color}`
        }
        aria-pressed={isSel}
        onFocus={() => setSelected(it.id)}
        onPointerDown={(e) => onItemDown(e, it, "move")}
        onPointerMove={onItemMove}
        onPointerUp={onItemUp}
        onPointerCancel={onItemUp}
        onDoubleClick={() => it.kind === "text" && setEditing(it.id)}
      >
        {isEditing ? (
          <textarea
            autoFocus
            aria-label="Texte de la planche"
            value={it.text}
            onChange={(e) => updateItem(it.id, { text: e.target.value })}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => e.key === "Escape" && (e.currentTarget as HTMLTextAreaElement).blur()}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              fontSize: `${TEXT_STYLES[it.style].size}cqw`,
              color: it.color,
              textAlign: it.align,
            }}
          />
        ) : (
          content
        )}
        {isSel && !isEditing && (
          <span
            className="mood-handle"
            aria-hidden
            onPointerDown={(e) => onItemDown(e, it, "resize")}
            onPointerMove={onItemMove}
            onPointerUp={onItemUp}
            onPointerCancel={onItemUp}
          />
        )}
      </div>
    );
  };

  const saveLabel =
    status === "saving" ? "Enregistrement…" : status === "error" ? "Non enregistré" : "Enregistré";
  const nonEmpty = boards.some((b) => b.items.length);

  return (
    <main className="workspace mood-page">
      <Breadcrumb
        items={[
          { label: "Devis", to: "/app" },
          { label: `${number} · ${project}`, to: `/app/quotes/${id}` },
          { label: "Mood board" },
        ]}
      />
      <header className="quote-header mood-header">
        <div>
          <div className="eyebrow">{number}</div>
          <h1>Mood board</h1>
          <div className="status-line">
            <s-badge tone={status === "error" ? "critical" : status === "saving" ? "info" : "success"}>
              {saveLabel}
            </s-badge>
            <span className="muted">{project}</span>
          </div>
        </div>
        <div className="header-actions">
          <details className="action-menu mood-export">
            <summary>{busy && busy !== "upload" ? "Préparation…" : "Exporter"}</summary>
            <div>
              <button disabled={!!busy || !nonEmpty} onClick={() => download("pptx")}>
                PowerPoint, toutes les pièces
                <small>S'ouvre aussi dans Canva et Keynote</small>
              </button>
              <button disabled={!!busy || !nonEmpty} onClick={() => download("pdf")}>
                PDF, toutes les pièces
                <small>Une page par pièce</small>
              </button>
              <button disabled={!!busy || !board.items.length} onClick={() => download("pdf", key)}>
                PDF de cette planche
              </button>
              <button disabled={!!busy || !board.items.length} onClick={() => download("png", key)}>
                Image HD de cette planche
                <small>PNG 3840 × 2160, pour Photoshop</small>
              </button>
            </div>
          </details>
        </div>
      </header>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "error" : "success"}>
          {message.text}
        </p>
      )}

      {sections.length === 0 ? (
        <s-section>
          <p>Ajoutez des produits au devis : chaque pièce aura sa planche.</p>
        </s-section>
      ) : (
        <>
          {sections.length > 1 && (
            <div className="mood-tabs" role="tablist" aria-label="Planches">
              {sections.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={s.key === key}
                  className={s.key === key ? "active" : ""}
                  onClick={() => {
                    setKey(s.key);
                    setSelected(null);
                    setEditing(null);
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          )}

          <div className="mood-layout">
            <aside className="mood-palette" aria-label="Photos et éléments">
              <div className="mood-palette-actions">
                <button type="button" onClick={addText}>Texte</button>
                <button type="button" onClick={addColor}>Couleur</button>
                <button type="button" disabled={busy === "upload"} onClick={() => fileInput.current?.click()}>
                  {busy === "upload" ? "Envoi…" : "Ajouter une photo"}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = [...(e.target.files || [])];
                    e.target.value = "";
                    if (files.length) void upload(files);
                  }}
                />
              </div>
              <p className="muted mood-hint">
                Touchez une photo pour l'ajouter, ou glissez-la sur la planche.
              </p>
              <ul className="mood-photos">
                {palette.map((p) => {
                  const u = p.tag === "ajout" ? uploads.find((x) => `upload:${x.id}` === p.src) : null;
                  return (
                    <li key={p.src}>
                      <button
                        type="button"
                        className="mood-photo"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-mood-photo", JSON.stringify({ src: p.src, alt: p.alt }));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => void addPhoto(p)}
                        title={p.alt}
                      >
                        <img src={p.src.startsWith("upload:") ? resolve(p.src) : sized(p.src, 400)} alt="" loading="lazy" />
                        <span className={`mood-tag tag-${p.tag}`}>{TAGS[p.tag]}</span>
                        <span className="mood-photo-name">{p.alt}</span>
                      </button>
                      {u &&
                        (confirmDelete === u.id ? (
                          <span className="mood-remove-confirm">
                            <button type="button" className="danger" onClick={() => void removeUpload(u)}>
                              Supprimer
                            </button>
                            <button type="button" onClick={() => setConfirmDelete(null)}>
                              Garder
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="mood-remove"
                            aria-label={`Supprimer la photo ${u.name}`}
                            onClick={() => setConfirmDelete(u.id)}
                          >
                            ×
                          </button>
                        ))}
                    </li>
                  );
                })}
              </ul>
              {!palette.length && (
                <p className="muted">Aucune photo pour cette pièce. Ajoutez les vôtres.</p>
              )}
            </aside>

            <section className="mood-stage" aria-label={`Planche ${section?.title || ""}`}>
              <div className="mood-toolbar" role="toolbar" aria-label="Mise en forme">
                {!item && (
                  <>
                    <span className="mood-label">Fond</span>
                    {BACKGROUNDS.map((bg) => (
                      <button
                        key={bg.value}
                        type="button"
                        className={`mood-swatch${board.background === bg.value ? " active" : ""}`}
                        style={{ background: bg.value }}
                        aria-label={`Fond ${bg.label}`}
                        aria-pressed={board.background === bg.value}
                        onClick={() => updateBoard((b) => withBackground(b, bg.value))}
                      />
                    ))}
                    <span className="mood-sep" />
                    <button type="button" onClick={() => void relayout()}>
                      Disposer automatiquement
                    </button>
                  </>
                )}
                {item?.kind === "text" && (
                  <>
                    <select
                      aria-label="Style du texte"
                      value={item.style}
                      onChange={(e) => updateItem(item.id, { style: e.target.value as TextStyle })}
                    >
                      {Object.entries(TEXT_STYLES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    {(["left", "center", "right"] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={item.align === a}
                        className={item.align === a ? "active" : ""}
                        onClick={() => updateItem(item.id, { align: a })}
                      >
                        {a === "left" ? "Gauche" : a === "center" ? "Centré" : "Droite"}
                      </button>
                    ))}
                    {INKS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`mood-swatch${item.color === c ? " active" : ""}`}
                        style={{ background: c }}
                        aria-label={`Couleur du texte ${c}`}
                        aria-pressed={item.color === c}
                        onClick={() => updateItem(item.id, { color: c })}
                      />
                    ))}
                    <button type="button" onClick={() => setEditing(item.id)}>
                      Modifier le texte
                    </button>
                  </>
                )}
                {item?.kind === "color" && (
                  <>
                    <label className="mood-color-field">
                      <span className="mood-label">Teinte</span>
                      <input
                        type="color"
                        value={item.color}
                        onChange={(e) => updateItem(item.id, { color: e.target.value })}
                      />
                    </label>
                    <input
                      type="text"
                      className="mood-color-name"
                      placeholder="Nom (ex. chêne fumé)"
                      maxLength={80}
                      value={item.label}
                      onChange={(e) => updateItem(item.id, { label: e.target.value })}
                    />
                  </>
                )}
                {item && (
                  <>
                    {item.kind !== "photo" && <span className="mood-sep" />}
                    <button type="button" onClick={() => reorder(true)}>Premier plan</button>
                    <button type="button" onClick={() => reorder(false)}>Arrière-plan</button>
                    <button type="button" onClick={duplicate}>Dupliquer</button>
                    <button type="button" className="danger" onClick={removeSelected}>
                      Retirer
                    </button>
                  </>
                )}
                <span className="mood-toolbar-end">
                  <button type="button" disabled={!past.length} onClick={undo}>
                    Annuler
                  </button>
                  <button type="button" disabled={!future.length} onClick={redo}>
                    Rétablir
                  </button>
                </span>
              </div>
              <div
                ref={boardRef}
                className={`mood-board${dropping ? " drop-over" : ""}`}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("mood-canvas")) {
                    setSelected(null);
                    setEditing(null);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDropping(true);
                }}
                onDragLeave={() => setDropping(false)}
                onDrop={onDrop}
              >
                <BoardView board={board} resolve={resolve} renderItem={renderItem} className="mood-canvas" />
              </div>
              <p className="muted mood-hint">
                Glissez pour déplacer, tirez le coin pour agrandir. Double-cliquez sur un texte pour l'écrire.
                Le mood board s'enregistre tout seul et ne change pas le devis.
              </p>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
