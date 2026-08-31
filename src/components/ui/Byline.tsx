import { createElement } from "react";

export default function Byline({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 text-xl font-bold">
      {createElement("ion-icon", { name: "people-circle" })}
      <span>{name}</span>
    </div>
  );
}
