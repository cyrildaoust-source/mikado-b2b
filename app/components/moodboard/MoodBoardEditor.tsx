import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { Breadcrumb } from "../Breadcrumb";
import { BoardView } from "./BoardView";
import { TEXTURE_GROUPS, textureUrl } from "../../domain/materials";
import { groupLibrary, libraryLabel, matchLibrary, type LibraryEntry } from "../../domain/library";
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
  /** Bibliothèque de matières de Mikado Deco (tissus en magasin). */
  library?: LibraryEntry[];
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
  finition: "Finition",
};
const INKS = ["#16181a", "#5f5d58", "#8a6a3d", "#ffffff"];
const INK_NAMES: Record<string, string> = {
  "#16181a": "noir",
  "#5f5d58": "gris",
  "#8a6a3d": "laiton",
  "#ffffff": "blanc",
};
const ALIGNS = [
  { value: "left", label: "Aligner à gauche" },
  { value: "center", label: "Centrer" },
  { value: "right", label: "Aligner à droite" },
] as const;

/** Petites icônes au trait, à la couleur du texte. */
function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const widths = [14, 9, 14, 7];
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {widths.map((w, n) => {
        const x = align === "left" ? 1 : align === "right" ? 15 - w : (16 - w) / 2;
        return <rect key={n} x={x} y={2 + n * 3.4} width={w} height="1.4" rx="0.7" fill="currentColor" />;
      })}
    </svg>
  );
}
function HistoryIcon({ redo }: { redo?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      style={redo ? { transform: "scaleX(-1)" } : undefined}
    >
      <path
        d="M5.5 3 2.5 6l3 3M2.8 6H10a3.5 3.5 0 0 1 0 7H6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
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
  library = [],
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
  // Colonne de gauche : photos des produits, ou matières (finitions, textures, échantillons).
  const [shelf, setShelf] = useState<"photos" | "matieres">("photos");
  const materialInput = useRef<HTMLInputElement>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const ratios = useRef(new Map<string, number>());
  const fileInput = useRef<HTMLInputElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const [moreTools, setMoreTools] = useState(false);

  const section = sections.find((s) => s.key === key);
  const board = boards.find((b) => b.key === key) || { key, background: "#ffffff", items: [] };
  const item = board.items.find((i) => i.id === selected) || null;
  const toolsKind = item?.kind || "board";

  // Barre d'outils : sur un écran étroit elle défile, un fondu signale la suite.
  useEffect(() => {
    const el = tools.current;
    if (!el) return;
    el.scrollLeft = 0;
    const check = () => setMoreTools(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
    };
  }, [toolsKind, key]);

  // Un message de réussite s'efface tout seul ; une erreur reste affichée.
  useEffect(() => {
    if (message?.tone !== "ok") return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const resolve = useCallback(
    (src: string) =>
      src.startsWith("upload:")
        ? `/app/quotes/${id}/moodboard/image/${src.slice(7)}`
        : src.startsWith("library:")
          ? `/app/matieres/image/${src.slice(8)}`
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
        if (src.startsWith("upload:") || src.startsWith("library:")) {
          const u =
            uploads.find((x) => `upload:${x.id}` === src) ||
            library.find((x) => `library:${x.id}` === src);
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
    [resolve, uploads, library],
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

  /** Échantillon de matière : photo carrée, nom, éditeur, référence. */
  const addMaterial = async (
    m: { src: string; name: string; maker?: string; reference?: string },
    at?: { x: number; y: number },
  ) => {
    const ratio = await measure(m.src);
    const w = 0.12,
      h = w * BOARD_RATIO;
    addItem({
      id: newId(),
      kind: "material",
      src: m.src,
      ratio,
      name: m.name,
      maker: m.maker || "",
      reference: m.reference || "",
      w,
      h,
      ...place(w, h, at),
    });
  };
  /** Finition Shopify : sa photo d'échantillon, sinon sa couleur. */
  const addFinish = (f: PaletteItem, at?: { x: number; y: number }) => {
    if (f.src)
      return void addMaterial({ src: f.src, name: f.name ?? f.alt, maker: f.maker, reference: f.reference }, at);
    if (f.color)
      addItem({
        id: newId(),
        kind: "color",
        color: f.color,
        label: f.alt,
        w: 0.08,
        h: 0.08 * BOARD_RATIO,
        ...place(0.08, 0.08 * BOARD_RATIO, at),
      });
  };

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
    const material = e.dataTransfer.getData("application/x-mood-material");
    if (material) {
      const f = JSON.parse(material) as PaletteItem;
      addFinish(f, at);
      return;
    }
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
  async function upload(files: File[], at?: { x: number; y: number }, asMaterial = false) {
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
        if (asMaterial)
          await addMaterial({ src: `upload:${u.id}`, name: u.name.replace(/\.\w+$/, "") }, at);
        else await addPhoto({ src: `upload:${u.id}`, alt: u.name }, at);
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
      items: b.items.filter((i) => !((i.kind === "photo" || i.kind === "material") && i.src === src)),
    }));
    setBoards(next);
    latest.current = next;
    setPast([]);
    setFuture([]);
  }

  // ——— Exports
  async function download(format: "pptx" | "pdf" | "png", only?: string) {
    if (exportMenu.current) exportMenu.current.open = false;
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
        // Objet posé sur une planche à dessin : sa place et sa taille sont le
        // contenu (exception « essentielle » du critère 2.5.8), d'où un groupe
        // nommé plutôt qu'un bouton. Tab le sélectionne, les flèches le déplacent.
        role="group"
        aria-roledescription="élément de la planche"
        tabIndex={0}
        aria-label={`${
          it.kind === "photo"
            ? `Photo ${it.alt}`
            : it.kind === "text"
              ? `Texte ${it.text}`
              : it.kind === "material"
                ? `Matière ${it.name}`
                : `Couleur ${it.label || it.color}`
        }${isSel ? ", sélectionné" : ""}`}
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
  // Première ouverture : la planche de la pièce se dispose encore.
  const preparing = !!section && !boards.some((b) => b.key === key);
  const exporting = busy && busy !== "upload";

  return (
    <main className="workspace mood-page">
      <Breadcrumb
        items={[
          { label: "Devis", to: "/app/devis" },
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
        {sections.length > 0 && (
          <div className="header-actions">
            <details ref={exportMenu} className="action-menu mood-export">
              <summary aria-busy={exporting ? true : undefined}>
                {exporting ? "Préparation…" : "Exporter"}
              </summary>
              <div>
                <span className="mood-menu-label">Toutes les pièces</span>
                <button disabled={!!busy || !nonEmpty} onClick={() => download("pptx")}>
                  PowerPoint
                  <small>Une diapositive par pièce, s'ouvre dans Canva et Keynote</small>
                </button>
                <button disabled={!!busy || !nonEmpty} onClick={() => download("pdf")}>
                  PDF
                  <small>Une page par pièce</small>
                </button>
                <span className="mood-menu-label">Planche ouverte</span>
                <button disabled={!!busy || !board.items.length} onClick={() => download("pdf", key)}>
                  PDF
                  <small>{section?.title || "Cette planche"}, une page</small>
                </button>
                <button disabled={!!busy || !board.items.length} onClick={() => download("png", key)}>
                  Image HD
                  <small>PNG 3840 × 2160, pour Photoshop</small>
                </button>
              </div>
            </details>
          </div>
        )}
      </header>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`mood-message ${message.tone === "error" ? "error" : "success"}`}
        >
          <span>{message.text}</span>
          {message.tone === "error" && (
            <button type="button" className="text-button" onClick={() => setMessage(null)}>
              Fermer
            </button>
          )}
        </p>
      )}

      {sections.length === 0 ? (
        <section className="empty-state mood-empty">
          <h2>Aucun produit dans ce devis</h2>
          <p>Ajoutez des produits au devis : chaque pièce aura sa planche, avec les photos déjà posées.</p>
          <Link className="button primary" to={`/app/quotes/${id}`}>
            Ouvrir le devis
          </Link>
        </section>
      ) : (
        <>
          {sections.length > 1 && (
            <div className="mood-tabs" role="tablist" aria-label="Planches">
              {sections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={s.key === key}
                  className={s.key === key ? "active" : ""}
                  title={s.title}
                  onClick={() => {
                    setKey(s.key);
                    setSelected(null);
                    setEditing(null);
                  }}
                >
                  <span className="mood-tab-label">{s.title}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mood-layout">
            <aside className="mood-palette" aria-label="Photos et éléments">
              <div className="mood-palette-actions">
                <button type="button" onClick={addText} disabled={preparing}>
                  Texte
                </button>
                <button type="button" onClick={addColor} disabled={preparing}>
                  Couleur
                </button>
                <button
                  type="button"
                  className="mood-add-photo"
                  disabled={busy === "upload" || preparing}
                  onClick={() => fileInput.current?.click()}
                >
                  {busy === "upload" ? "Envoi en cours…" : "Ajouter une photo"}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  style={{ display: "none" }}
                  aria-label="Photos à ajouter"
                  onChange={(e) => {
                    const files = [...(e.target.files || [])];
                    e.target.value = "";
                    if (files.length) void upload(files);
                  }}
                />
              </div>
              <div className="mood-shelf-tabs" role="tablist" aria-label="Contenu de la colonne">
                <button
                  type="button"
                  role="tab"
                  aria-selected={shelf === "photos"}
                  className={shelf === "photos" ? "active" : ""}
                  onClick={() => setShelf("photos")}
                >
                  Photos
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={shelf === "matieres"}
                  className={shelf === "matieres" ? "active" : ""}
                  onClick={() => setShelf("matieres")}
                >
                  Matières
                </button>
              </div>
              {shelf === "photos" ? (
                <>
              {palette.length > 0 ? (
                <>
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
                            disabled={preparing}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("application/x-mood-photo", JSON.stringify({ src: p.src, alt: p.alt }));
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            onClick={() => void addPhoto(p)}
                            title={p.alt}
                            aria-label={`Ajouter ${p.alt || "la photo"} (${TAGS[p.tag].toLowerCase()})`}
                          >
                            <img src={p.src.startsWith("upload:") ? resolve(p.src) : sized(p.src, 400)} alt="" loading="lazy" />
                            <span className={`mood-tag tag-${p.tag}`}>{TAGS[p.tag]}</span>
                            <span className="mood-photo-name">{p.alt || "Photo"}</span>
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
                                title="Supprimer cette photo"
                                onClick={() => setConfirmDelete(u.id)}
                              >
                                <span aria-hidden="true">×</span>
                              </button>
                            ))}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="mood-palette-empty">
                  Aucune photo pour cette pièce. Ajoutez les vôtres : JPEG, PNG ou WebP.
                </p>
              )}
                </>
              ) : (
                <div className="mood-materials">
                  <button
                    type="button"
                    className="mood-add-photo"
                    disabled={busy === "upload" || preparing}
                    onClick={() => materialInput.current?.click()}
                  >
                    {busy === "upload" ? "Envoi en cours…" : "Ajouter mon échantillon"}
                  </button>
                  <input
                    ref={materialInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    style={{ display: "none" }}
                    aria-label="Photos d'échantillons à ajouter"
                    onChange={(e) => {
                      const files = [...(e.target.files || [])];
                      e.target.value = "";
                      if (files.length) void upload(files, undefined, true);
                    }}
                  />
                  <p className="muted mood-hint">
                    Un tissu, un marbre ou un bois absent de la liste : photographiez l'échantillon, puis indiquez
                    son nom, l'éditeur et la référence.
                  </p>
                  {(section?.finishes.length || 0) > 0 && (
                    <MaterialGroup
                      label="Finitions des produits"
                      items={section!.finishes.map((f) => ({ ...f, key: `${f.src || f.color}-${f.alt}` }))}
                      onAdd={(f) => addFinish(f)}
                      thumb={(f) => (f.src ? sized(f.src, 300) : "")}
                      disabled={preparing}
                    />
                  )}
                  {uploads.length > 0 && (
                    <MaterialGroup
                      label="Mes photos"
                      items={uploads.map((u) => ({
                        key: u.id,
                        src: `upload:${u.id}`,
                        alt: u.name.replace(/\.\w+$/, ""),
                        tag: "ajout" as const,
                      }))}
                      onAdd={(f) => void addMaterial({ src: f.src, name: f.alt })}
                      thumb={(f) => resolve(f.src)}
                      disabled={preparing}
                    />
                  )}
                  {library.length > 0 && (
                    <LibraryShelf
                      library={library}
                      query={libraryQuery}
                      onQuery={setLibraryQuery}
                      onAdd={(f) => addFinish(f)}
                      thumb={(f) => resolve(f.src)}
                      disabled={preparing}
                    />
                  )}
                  {TEXTURE_GROUPS.map((g) => (
                    <MaterialGroup
                      key={g.label}
                      label={g.label}
                      items={g.items.map((t) => ({
                        key: t.id,
                        src: textureUrl(t.id),
                        alt: t.name,
                        tag: "finition" as const,
                      }))}
                      onAdd={(f) => void addMaterial({ src: f.src, name: f.alt })}
                      thumb={(f) => f.src}
                      disabled={preparing}
                    />
                  ))}
                  <p className="muted mood-hint">Textures génériques Poly Haven, libres de droits (CC0).</p>
                </div>
              )}
            </aside>

            <section className="mood-stage" aria-label={`Planche ${section?.title || ""}`}>
              <div className="mood-toolbar" role="toolbar" aria-label="Mise en forme">
                <div
                  ref={tools}
                  key={toolsKind}
                  className={`mood-tools${moreTools ? " has-more" : ""}`}
                >
                  {!item && (
                    <>
                      <span className="mood-label" id="mood-bg-label">
                        Fond
                      </span>
                      <span className="mood-swatches" role="group" aria-labelledby="mood-bg-label">
                        {BACKGROUNDS.map((bg) => (
                          <button
                            key={bg.value}
                            type="button"
                            className={`mood-swatch${board.background === bg.value ? " active" : ""}`}
                            aria-label={`Fond ${bg.label}`}
                            title={bg.label}
                            aria-pressed={board.background === bg.value}
                            disabled={preparing}
                            onClick={() => updateBoard((b) => withBackground(b, bg.value))}
                          >
                            <span style={{ background: bg.value }} />
                          </button>
                        ))}
                      </span>
                      <span className="mood-sep" aria-hidden="true" />
                      <button type="button" disabled={preparing} onClick={() => void relayout()}>
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
                      <span className="mood-group" role="group" aria-label="Alignement">
                        {ALIGNS.map((a) => (
                          <button
                            key={a.value}
                            type="button"
                            className={`mood-icon${item.align === a.value ? " active" : ""}`}
                            aria-label={a.label}
                            title={a.label}
                            aria-pressed={item.align === a.value}
                            onClick={() => updateItem(item.id, { align: a.value })}
                          >
                            <AlignIcon align={a.value} />
                          </button>
                        ))}
                      </span>
                      <span className="mood-swatches" role="group" aria-label="Couleur du texte">
                        {INKS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`mood-swatch${item.color === c ? " active" : ""}`}
                            aria-label={`Texte ${INK_NAMES[c]}`}
                            title={INK_NAMES[c]}
                            aria-pressed={item.color === c}
                            onClick={() => updateItem(item.id, { color: c })}
                          >
                            <span style={{ background: c }} />
                          </button>
                        ))}
                      </span>
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
                        aria-label="Nom de la couleur"
                        placeholder="Nom (ex. chêne fumé)"
                        maxLength={80}
                        value={item.label}
                        onChange={(e) => updateItem(item.id, { label: e.target.value })}
                      />
                    </>
                  )}
                  {item?.kind === "material" && (
                    <>
                      <input
                        type="text"
                        className="mood-material-field"
                        aria-label="Nom de la matière"
                        placeholder="Nom (ex. Hallingdal 65)"
                        maxLength={120}
                        value={item.name}
                        onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      />
                      <input
                        type="text"
                        className="mood-material-field"
                        aria-label="Éditeur"
                        placeholder="Éditeur (ex. Kvadrat)"
                        maxLength={120}
                        value={item.maker}
                        onChange={(e) => updateItem(item.id, { maker: e.target.value })}
                      />
                      <input
                        type="text"
                        className="mood-material-field mood-material-ref"
                        aria-label="Référence"
                        placeholder="Réf. (ex. 130)"
                        maxLength={120}
                        value={item.reference}
                        onChange={(e) => updateItem(item.id, { reference: e.target.value })}
                      />
                    </>
                  )}
                  {item && (
                    <>
                      {item.kind !== "photo" && <span className="mood-sep" aria-hidden="true" />}
                      <button type="button" onClick={() => reorder(true)}>
                        Premier plan
                      </button>
                      <button type="button" onClick={() => reorder(false)}>
                        Arrière-plan
                      </button>
                      <button type="button" onClick={duplicate}>
                        Dupliquer
                      </button>
                      <button type="button" className="danger" onClick={removeSelected}>
                        Retirer
                      </button>
                    </>
                  )}
                </div>
                <span className="mood-toolbar-end">
                  <button type="button" className="mood-history" disabled={!past.length} onClick={undo} title="Annuler (Ctrl Z)">
                    <HistoryIcon />
                    <span className="mood-btn-label">Annuler</span>
                  </button>
                  <button
                    type="button"
                    className="mood-history"
                    disabled={!future.length}
                    onClick={redo}
                    title="Rétablir (Ctrl Maj Z)"
                  >
                    <HistoryIcon redo />
                    <span className="mood-btn-label">Rétablir</span>
                  </button>
                </span>
              </div>
              <div
                ref={boardRef}
                className={`mood-board${dropping ? " drop-over" : ""}`}
                aria-busy={preparing || undefined}
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
                {preparing ? (
                  <div className="mood-board-state" role="status">
                    <span className="mood-spinner" aria-hidden="true" />
                    Mise en page de la planche…
                  </div>
                ) : (
                  !board.items.length && (
                    <div className="mood-board-state">
                      Planche vide. Touchez une photo pour la poser ici, ou ajoutez un texte.
                    </div>
                  )
                )}
              </div>
              <p className="muted mood-hint">
                Glissez pour déplacer, tirez le rond du coin pour agrandir, touchez à nouveau un texte pour
                l'écrire. Le mood board s'enregistre tout seul et ne change pas le devis.
              </p>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

/** Vignettes affichées par éditeur avant de demander une recherche plus précise. */
const LIBRARY_SHOWN = 36;

/** Bibliothèque Mikado : tissus en magasin, par éditeur, avec recherche. */
function LibraryShelf({
  library,
  query,
  onQuery,
  onAdd,
  thumb,
  disabled,
}: {
  library: LibraryEntry[];
  query: string;
  onQuery: (q: string) => void;
  onAdd: (item: PaletteItem) => void;
  thumb: (item: PaletteItem) => string;
  disabled?: boolean;
}) {
  const found = query.trim() ? library.filter((m) => matchLibrary(m, query)) : library;
  const groups = groupLibrary(found);
  return (
    <div className="mood-library">
      <label className="mood-material-field mood-library-search">
        <span>Bibliothèque Mikado Deco</span>
        <input
          type="search"
          value={query}
          placeholder="Ex. Hallingdal 130"
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      {groups.length === 0 && <p className="muted mood-hint">Aucune matière ne correspond.</p>}
      {groups.map((g) => (
        <div key={g.maker}>
          <MaterialGroup
            label={`${g.maker} (${g.items.length})`}
            items={g.items.slice(0, LIBRARY_SHOWN).map((m) => ({
              key: m.id,
              src: `library:${m.id}`,
              alt: libraryLabel(m),
              name: m.collection,
              reference: m.colour,
              maker: m.maker,
              tag: "finition" as const,
            }))}
            onAdd={onAdd}
            thumb={thumb}
            disabled={disabled}
          />
          {g.items.length > LIBRARY_SHOWN && (
            <p className="muted mood-hint">
              {g.items.length - LIBRARY_SHOWN} autres : précisez la recherche.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Groupe de matières dans la colonne : vignettes carrées, toucher ou glisser. */
function MaterialGroup({
  label,
  items,
  onAdd,
  thumb,
  disabled,
}: {
  label: string;
  items: (PaletteItem & { key: string })[];
  onAdd: (item: PaletteItem) => void;
  thumb: (item: PaletteItem) => string;
  disabled?: boolean;
}) {
  return (
    <section className="mood-material-group" aria-label={label}>
      <h3>{label}</h3>
      <ul>
        {items.map((m) => {
          const src = thumb(m);
          return (
            <li key={m.key}>
              <button
                type="button"
                className="mood-material"
                draggable
                disabled={disabled}
                title={m.maker ? `${m.alt} · ${m.maker}` : m.alt}
                aria-label={`Ajouter la matière ${m.alt}`}
                onDragStart={(e) => {
                  const { key: _key, ...data } = m;
                  e.dataTransfer.setData("application/x-mood-material", JSON.stringify(data));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(m)}
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      // Texture indisponible : la vignette disparaît.
                      (e.currentTarget.closest("li") as HTMLElement | null)?.setAttribute("hidden", "");
                    }}
                  />
                ) : (
                  <span className="mood-material-color" style={{ background: m.color }} />
                )}
                <span className="mood-photo-name">{m.name ?? m.alt}</span>
                {m.reference && <span className="mood-photo-name mood-material-colour">{m.reference}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
