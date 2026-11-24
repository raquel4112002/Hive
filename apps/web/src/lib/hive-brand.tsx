// Hive modification: the organization brand on the page.
// Derived from Rakazo (Apache License 2.0).

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export interface HiveBrand {
  productName: string;
  loginText: string;
  primary: string | null;
  primaryForeground: string | null;
  primaryWarning: string | null;
  accent: string | null;
  accentForeground: string | null;
  accentWarning: string | null;
  logoLight: string | null;
  logoDark: string | null;
  favicon: string | null;
  avatars: Array<{ botId: string; image: string }>;
}

const BrandContext = createContext<HiveBrand | null>(null);

export function useHiveBrand(): HiveBrand | null {
  return useContext(BrandContext);
}

export function hiveBrandMark(brand: HiveBrand | null): string | null {
  const dark = document.documentElement.classList.contains("dark");
  if (!brand) return null;
  return dark ? brand.logoDark || brand.logoLight : brand.logoLight || brand.logoDark;
}

function applyBrand(brand: HiveBrand) {
  const root = document.documentElement;
  if (brand.primary && brand.primaryForeground) {
    root.style.setProperty("--primary", brand.primary);
    root.style.setProperty("--primary-foreground", brand.primaryForeground);
    root.style.setProperty("--sidebar-primary", brand.primary);
    root.style.setProperty("--sidebar-primary-foreground", brand.primaryForeground);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--sidebar-primary");
    root.style.removeProperty("--sidebar-primary-foreground");
  }
  if (brand.accent) root.style.setProperty("--brand-accent", brand.accent);
  else root.style.removeProperty("--brand-accent");
  document.title = brand.productName || "Hive";
  if (!brand.favicon) return;
  let icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.appendChild(icon);
  }
  icon.href = brand.favicon;
}

export function HiveBrandProvider({
  invite,
  signedIn,
  children,
}: {
  invite: string;
  signedIn: boolean;
  children: ReactNode;
}) {
  const [brand, setBrand] = useState<HiveBrand | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const onChange = () => setReload((value) => value + 1);
    window.addEventListener("hive-brand", onChange);
    return () => window.removeEventListener("hive-brand", onChange);
  }, []);
  useEffect(() => {
    const query = invite ? `?invite=${encodeURIComponent(invite)}` : "";
    let active = true;
    void fetch(`/api/hive/brand${query}`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: HiveBrand | null) => {
        if (active && body?.productName) setBrand(body);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [invite, signedIn, reload]);
  useEffect(() => {
    if (brand) applyBrand(brand);
  }, [brand]);
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function refreshHiveBrand() {
  window.dispatchEvent(new Event("hive-brand"));
}
