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
    dialog?.showModal();
    return () => dialog?.close();
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
