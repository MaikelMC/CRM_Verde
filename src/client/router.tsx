import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Role, Session } from "./session";

export type Route = "vender" | "productos" | "inventario" | "caja" | "reporte";
export type ScreenProps = { session: Session };

const LOADERS: Record<Route, () => Promise<{ default: ComponentType<ScreenProps> }>> = {
  vender: () => import("./screens/Sell"),
  productos: () => import("./screens/Products"),
  inventario: () => import("./screens/Inventory"),
  caja: () => import("./screens/Cash"),
  reporte: () => import("./screens/Report"),
};

// El cajero no ve Productos; Inventario solo en lectura (la pantalla lo respeta).
export const NAV: { route: Route; label: string; roles: Role[] }[] = [
  { route: "vender", label: "Vender", roles: ["dueno", "gerente", "cajero"] },
  { route: "productos", label: "Productos", roles: ["dueno", "gerente"] },
  { route: "inventario", label: "Inventario", roles: ["dueno", "gerente", "cajero"] },
  { route: "caja", label: "Caja", roles: ["dueno", "gerente", "cajero"] },
  { route: "reporte", label: "Reporte", roles: ["dueno", "gerente", "cajero"] },
];

export const navDe = (role: Role) => NAV.filter((n) => n.roles.includes(role));

function parseHash(): Route {
  const hash = location.hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return (Object.keys(LOADERS) as Route[]).find((r) => r === hash) ?? "vender";
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function Screen({ route, session }: { route: Route; session: Session }) {
  const [Comp, setComp] = useState<ComponentType<ScreenProps> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(false);
    setComp(null);
    LOADERS[route]()
      .then((m) => alive && setComp(() => m.default))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [route]);

  if (error) return <p class="estado">No se pudo cargar la pantalla. Revisa la conexión y reintenta.</p>;
  if (!Comp) return <p class="estado">Cargando…</p>;
  return <Comp session={session} />;
}

export function NavBar({ route, role, bajos }: { route: Route; role: Role; bajos: number }) {
  return (
    <nav class="nav">
      {navDe(role).map((n) => (
        <a key={n.route} href={`#/${n.route}`} class={n.route === route ? "nav-item activo" : "nav-item"}>
          <span>{n.label}</span>
          {n.route === "inventario" && bajos > 0 && <span class="badge">{bajos}</span>}
        </a>
      ))}
    </nav>
  );
}
