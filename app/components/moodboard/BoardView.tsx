import type { CSSProperties, ReactNode } from "react";
import {
  BOARD_RATIO,
  TEXT_STYLES,
  isDark,
  materialCaption,
  type Board,
  type BoardItem,
} from "../../domain/moodboard";

/*
 * Rendu d'une planche, le même à l'écran, dans le PDF et dans l'image HD.
 * Styles en ligne : l'export n'a pas la feuille de l'outil. Les tailles de
 * texte sont en cqw (pour cent de la largeur de la planche), la planche peut
 * donc s'afficher à toute largeur.
 */
export function BoardView({
  board,
  resolve,
  renderItem,
  className,
  style,
  children,
  font = "Inter, -apple-system, 'Segoe UI', Arial, sans-serif",
}: {
  board: Board;
  /** Adresse affichable d'une photo (upload:… vers l'adresse du serveur). */
  resolve: (src: string, item: BoardItem) => string;
  /** Écran : enveloppe chaque élément (sélection, glisser). */
  renderItem?: (item: BoardItem, content: ReactNode, style: CSSProperties) => ReactNode;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  font?: string;
}) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: String(BOARD_RATIO),
        background: board.background,
        overflow: "hidden",
        containerType: "inline-size",
        fontFamily: font,
        ...style,
      }}
    >
      {board.items.map((item) => {
        const box: CSSProperties = {
          position: "absolute",
          left: `${item.x * 100}%`,
          top: `${item.y * 100}%`,
          width: `${item.w * 100}%`,
          height: `${item.h * 100}%`,
        };
        const content = (
          <ItemContent item={item} resolve={resolve} dark={isDark(board.background)} />
        );
        return renderItem ? (
          renderItem(item, content, box)
        ) : (
          <div key={item.id} style={box}>
            {content}
          </div>
        );
      })}
      {children}
    </div>
  );
}

function ItemContent({
  item,
  resolve,
  dark,
}: {
  item: BoardItem;
  resolve: (src: string, item: BoardItem) => string;
  dark: boolean;
}) {
  if (item.kind === "material") {
    const caption = materialCaption(item);
    return (
      <>
        <img
          src={resolve(item.src, item)}
          alt={item.name}
          draggable={false}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            userSelect: "none",
            pointerEvents: "none",
            boxShadow: "inset 0 0 0 1px rgba(22,24,26,0.08)",
          }}
        />
        {(item.name || caption) && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              width: "max(100%, 14cqw)",
              paddingTop: "0.4cqw",
              fontSize: `${TEXT_STYLES.small.size}cqw`,
              lineHeight: 1.3,
              color: dark ? "#d6d3cc" : "#5f5d58",
            }}
          >
            {item.name && (
              <div style={{ color: dark ? "#ffffff" : "#16181a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </div>
            )}
            {caption && (
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{caption}</div>
            )}
          </div>
        )}
      </>
    );
  }
  if (item.kind === "photo")
    return (
      <img
        src={resolve(item.src, item)}
        alt={item.alt}
        draggable={false}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          userSelect: "none",
          pointerEvents: "none",
        }}
      />
    );
  if (item.kind === "color")
    return (
      <>
        <div
          style={{
            width: "100%",
            height: "100%",
            background: item.color,
            boxShadow: "inset 0 0 0 1px rgba(22,24,26,0.08)",
          }}
        />
        {item.label && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              paddingTop: "0.4cqw",
              fontSize: `${TEXT_STYLES.small.size}cqw`,
              lineHeight: 1.25,
              color: "#5f5d58",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label}
          </div>
        )}
      </>
    );
  const t = TEXT_STYLES[item.style];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        fontSize: `${t.size}cqw`,
        fontWeight: t.weight,
        lineHeight: 1.25,
        letterSpacing: item.style === "title" ? "-0.01em" : undefined,
        color: item.color,
        textAlign: item.align,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}
    >
      {item.text}
    </div>
  );
}
