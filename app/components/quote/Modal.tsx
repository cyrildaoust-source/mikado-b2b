import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    // Élément qui a ouvert la fenêtre : il reprend le focus à la fermeture.
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    // Le focus va au premier champ à remplir, pas au bouton « Fermer ».
    // Sur écran tactile on le laisse : le clavier masquerait la fenêtre.
    if (matchMedia("(pointer: fine)").matches)
      dialog
        ?.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not(:disabled), textarea:not(:disabled)',
        )
        ?.focus();
    return () => {
      dialog?.close();
      if (!opener?.isConnected) return;
      // Ouvreur rangé dans un menu refermé (« Autres actions ») : le focus
      // revient au bouton du menu.
      const menu = opener.closest("details:not([open])");
      (menu?.querySelector<HTMLElement>("summary") ?? opener).focus({
        preventScroll: true,
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide-dialog" : ""}
      onCancel={onClose}
      aria-label={title}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Fermer">
          Fermer
        </button>
      </header>
      {children}
    </dialog>
  );
}
