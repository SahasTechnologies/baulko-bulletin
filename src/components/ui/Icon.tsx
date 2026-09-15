import { ICONS } from "@/lib/icons.generated";

/**
 * The client-island twin of `Icon.astro` — same reasoning, same generated
 * markup (see that file). Used by the React components, which render icons
 * after hydration too (the theme toggle swaps sun for moon on click), so the
 * icon has to come from the bundle rather than from the server's HTML.
 */
export default function Icon({ name, className }: { name: string; className?: string }) {
  const markup = ICONS[name];
  if (!markup) return null;

  return (
    <span
      className={className ? `icon ${className}` : "icon"}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
