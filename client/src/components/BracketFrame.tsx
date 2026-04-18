import type { ReactNode } from "react";

/**
 * Black panel with four L-shaped white corner brackets (no continuous
 * border). Used by the part caption and the exterior HUD corners.
 *
 * Consumers MUST supply a positioning class (`relative`, `fixed`, or
 * `absolute`) in `className` — the corner spans are absolutely positioned
 * and need a containing block. We don't bake `relative` in here because
 * Tailwind v4's CSS emits utilities alphabetically; when a consumer also
 * applies `fixed`, the baked-in `relative` wins the cascade and breaks
 * fixed positioning.
 */
export function BracketFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-black ${className}`}>
      <span className="absolute -top-px -left-px h-2 w-2 border-t-[0.5px] border-l-[0.5px] border-white" />
      <span className="absolute -top-px -right-px h-2 w-2 border-t-[0.5px] border-r-[0.5px] border-white" />
      <span className="absolute -bottom-px -left-px h-2 w-2 border-b-[0.5px] border-l-[0.5px] border-white" />
      <span className="absolute -bottom-px -right-px h-2 w-2 border-b-[0.5px] border-r-[0.5px] border-white" />
      {children}
    </div>
  );
}
