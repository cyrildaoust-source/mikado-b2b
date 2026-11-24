import { useEffect, useState } from "react";
import { useBeforeUnload } from "react-router";
import {
  quoteSchema,
  repriceExtras,
  type QuoteState,
} from "../../domain/quote";
export function useDraft(initial: string, key: string | null, version: number) {
  const [state, setState] = useState(() =>
      quoteSchema.parse(JSON.parse(initial)),
    ),
    [dirty, setDirty] = useState(false),
    [recovery, setRecovery] = useState<QuoteState | null>(null),
    [undo, setUndo] = useState<QuoteState | null>(null);
  useEffect(() => {
    if (!key) return;
    try {
      const r = JSON.parse(sessionStorage.getItem(key) || "null");
      if (r && r.version === version && Date.now() - r.savedAt < 8 * 3600000) {
        const p = quoteSchema.safeParse(r.state);
        if (p.success) setRecovery(p.data);
      }
    } catch {}
  }, [key, version]);
  useEffect(() => {
    if (!dirty || !key) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({ version, savedAt: Date.now(), state }),
        );
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [state, dirty, key, version]);
  useBeforeUnload((e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  function change(
    next: QuoteState | ((s: QuoteState) => QuoteState),
    reversible = false,
  ) {
    setState((s) => {
      if (reversible) setUndo(s);
      return repriceExtras(typeof next === "function" ? next(s) : next);
    });
    setDirty(true);
  }
  function clear() {
    try { if (key) sessionStorage.removeItem(key); } catch {}
    setRecovery(null);
  }
  function discard() {
    setState(quoteSchema.parse(JSON.parse(initial)));
    setDirty(false);
    setUndo(null);
    clear();
  }
  return {
    state,
    dirty,
    change,
    recovery,
    restore: () => {
      if (recovery) change(recovery);
      setRecovery(null);
    },
    ignore: clear,
    saved: ()=>{setDirty(false);setUndo(null);clear();},
    discard,
    undo: undo
      ? () => {
          change(undo);
          setUndo(null);
        }
      : null,
  };
}
