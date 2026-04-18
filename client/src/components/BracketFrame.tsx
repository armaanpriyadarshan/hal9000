import type { ReactNode } from "react";

/**
 * Black panel with four L-shaped white corner brackets (no continuous
 * border). Used by the part caption and the exterior HUD corners.
 * Consumers control padding/layout via className.
 */
export function BracketFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative bg-black ${className}`}>
      <span className="absolute -top-px -left-px h-2 w-2 border-t border-l border-white" />
      <span className="absolute -top-px -right-px h-2 w-2 border-t border-r border-white" />
      <span className="absolute -bottom-px -left-px h-2 w-2 border-b border-l border-white" />
      <span className="absolute -bottom-px -right-px h-2 w-2 border-b border-r border-white" />
      {children}
    </div>
  );
}
