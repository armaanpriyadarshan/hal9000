"use client";

import { useRef, type PointerEvent } from "react";

type Offset = { x: number; y: number };

/**
 * Absolute-positioned black info card with a hairline white border.
 * Dragging the card updates `offset` (leader line tracks it). Close
 * button triggers `onClose`. Designed to live inside drei `<Html>` so
 * its parent already sits at the 3D anchor point.
 */
export function DraggableCaption({
  offset,
  onOffsetChange,
  kind,
  name,
  description,
  onClose,
}: {
  offset: Offset;
  onOffsetChange: (next: Offset) => void;
  kind: string;
  name: string;
  description: string;
  onClose: () => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Ignore drags that start on the close button.
    if ((e.target as HTMLElement).closest("[data-caption-no-drag]")) return;
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    onOffsetChange({
      x: drag.startOffsetX + (e.clientX - drag.startClientX),
      y: drag.startOffsetY + (e.clientY - drag.startClientY),
    });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(dragRef.current.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      className="absolute bg-black border-[0.5px] border-white/50 px-3 py-2 w-[220px] cursor-move select-none"
      style={{
        left: offset.x,
        top: offset.y,
        pointerEvents: "auto",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <button
        type="button"
        onClick={onClose}
        data-caption-no-drag
        className="absolute top-1 right-1.5 font-mono text-[14px] leading-none text-white-dim hover:text-white cursor-pointer"
        aria-label="Clear highlight"
      >
        ×
      </button>
      <div className="font-mono uppercase tracking-[0.18em] text-[8px] text-white-dim pr-4">
        {kind}
      </div>
      <div className="font-serif text-[18px] leading-tight text-white mt-0.5 pr-4">
        {name}
      </div>
      <div className="mt-1.5 font-mono text-[9px] leading-snug text-white-dim">
        {description}
      </div>
    </div>
  );
}
