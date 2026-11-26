import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { ActiveShare } from "../../services/share.server";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Brussels",
  });

/**
 * Lien en ligne de la révision prête. Le lien complet n'est affiché qu'une fois,
 * juste après sa création ; ensuite on peut le remplacer ou le retirer.
 */
export function SharePanel({
  version,
  publishedNumber,
  share,
  disabled,
}: {
  version: number;
  publishedNumber: number | null;
  share: ActiveShare | null;
  disabled?: boolean;
}) {
  const f = useFetcher<{ ok?: string; error?: string; shareUrl?: string }>();
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = f.state !== "idle";
  const url = f.data?.shareUrl;
  useEffect(() => setCopied(false), [url]);
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      input.current?.select();
    }
  };
  const live = share && !share.expired;
  const older = live && share.version !== version;
  return (
    <section className="share-panel" aria-label="Proposition en ligne">
      <div className="share-head">
        <strong>Proposition en ligne</strong>
        {live ? (
          <span className="muted">
            Lien actif · R{share.publishedNumber} · valable jusqu'au{" "}
            {day(share.expiresAt)} ·{" "}
            {share.views
              ? `ouvert ${share.views} fois, la dernière le ${day(share.lastViewedAt!)}`
              : "pas encore ouvert"}
          </span>
        ) : share?.expired ? (
          <span className="muted">Le dernier lien a expiré.</span>
        ) : (
          <span className="muted">
            Votre client ouvre la proposition par un lien privé, sans compte.
            Les prix sont figés jusqu'à la date de validité.
          </span>
        )}
      </div>
      {older && (
        <p className="notice">
          Le lien montre encore R{share.publishedNumber}. Créez un nouveau lien
          pour partager R{publishedNumber} ; l'ancien cessera de fonctionner.
        </p>
      )}
      {url && (
        <div className="share-url">
          <input
            ref={input}
            readOnly
            value={url}
            aria-label="Lien de la proposition"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="primary" onClick={copy}>
            {copied ? "Copié" : "Copier le lien"}
          </button>
        </div>
      )}
      {f.data?.error && (
        <p role="alert" className="error">
          {f.data.error}
        </p>
      )}
      {f.data?.ok && (
        <p role="status" className="success">
          {f.data.ok}
        </p>
      )}
      <f.Form method="post" className="share-actions">
        <input type="hidden" name="version" value={version} />
        <button
          name="intent"
          value="share"
          disabled={disabled || busy}
          className={live ? undefined : "primary"}
        >
          {live ? "Remplacer le lien" : "Créer le lien"}
        </button>
        {live && (
          <button
            name="intent"
            value="unshare"
            className="text-button"
            disabled={disabled || busy}
          >
            Retirer le lien
          </button>
        )}
      </f.Form>
    </section>
  );
}
