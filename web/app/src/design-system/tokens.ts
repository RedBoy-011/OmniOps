/**
 * OmniOps Unified Design System Tokens (TypeScript)
 * Shared between Web App, Windows Edge, and Android/PWA.
 * Default Theme Palette: Magenta Velvet (قرمز / مجنتا)
 */

export type OmniThemePalette = "magenta" | "cyan" | "emerald" | "amber" | "indigo";

export interface PaletteDefinition {
  id: OmniThemePalette;
  name: string;
  primary: string;
  accent: string;
  bgApp: string;
  gradient: string;
}

export const OMNI_PALETTES: Record<OmniThemePalette, PaletteDefinition> = {
  magenta: {
    id: "magenta",
    name: "قرمز / مجنتا (پیش‌فرض)",
    primary: "#f43f5e",
    accent: "#d946ef",
    bgApp: "#100b15",
    gradient: "linear-gradient(135deg, #f43f5e 0%, #d946ef 100%)",
  },
  cyan: {
    id: "cyan",
    name: "سایبرپانک فیروزه‌ای",
    primary: "#00f0ff",
    accent: "#00ffaa",
    bgApp: "#0a0f1d",
    gradient: "linear-gradient(135deg, #00f0ff 0%, #00ffaa 100%)",
  },
  emerald: {
    id: "emerald",
    name: "زمردی / نعنایی",
    primary: "#10b981",
    accent: "#06b6d4",
    bgApp: "#061510",
    gradient: "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
  },
  amber: {
    id: "amber",
    name: "کهربایی خورشیدی",
    primary: "#f59e0b",
    accent: "#ef4444",
    bgApp: "#140e06",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
  },
  indigo: {
    id: "indigo",
    name: "کیهانی لاجوردی",
    primary: "#6366f1",
    accent: "#a855f7",
    bgApp: "#0b0c1b",
    gradient: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
  },
};

export const DEFAULT_PALETTE: OmniThemePalette = "magenta";

export const OMNI_COLORS = {
  brand: {
    primary: "#f43f5e",
    accent: "#d946ef",
    cyan: "#f43f5e",
    emerald: "#d946ef",
    mint: "#f9a8d4",
    gradient: "linear-gradient(135deg, #f43f5e 0%, #d946ef 100%)",
  },
  status: {
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#06b6d4",
  },
  dark: {
    bgApp: "#100b15",
    bgSurface: "rgba(28, 17, 33, 0.78)",
    border: "rgba(244, 63, 94, 0.20)",
    textPrimary: "#f4edf2",
    textSecondary: "#c4aab9",
  },
} as const;

export function applyThemePalette(palette: string) {
  const p = (palette in OMNI_PALETTES ? palette : DEFAULT_PALETTE) as OmniThemePalette;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme-palette", p);
    try {
      localStorage.setItem("omniops_theme_palette", p);
    } catch {}
  }
}

export function getActiveThemePalette(): OmniThemePalette {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme-palette");
    if (attr && attr in OMNI_PALETTES) return attr as OmniThemePalette;
    try {
      const saved = localStorage.getItem("omniops_theme_palette");
      if (saved && saved in OMNI_PALETTES) return saved as OmniThemePalette;
    } catch {}
  }
  return DEFAULT_PALETTE;
}

export type ModelCostTier = "free" | "ultra-low" | "low" | "standard" | "premium";

export interface ModelCostEstimate {
  tier: ModelCostTier;
  label: string;
  badgeClass: string;
  inputPerMillion: string;
  outputPerMillion: string;
  summary: string;
}

/**
 * Calculates estimated model operational cost per 1M tokens or local execution.
 */
export function estimateModelCost(
  modelName: string,
  pricingCatalog?: Record<string, { input: string; output: string }>
): ModelCostEstimate {
  const m = (modelName || "").toLowerCase().trim();

  if (pricingCatalog && pricingCatalog[modelName]) {
    const p = pricingCatalog[modelName];
    const isFree = p.input === "$0.00" && p.output === "$0.00";
    return {
      tier: isFree ? "free" : "standard",
      label: isFree ? "رایگان (Worker Local)" : `${p.input} / 1M`,
      badgeClass: isFree ? "free" : "standard",
      inputPerMillion: p.input,
      outputPerMillion: p.output,
      summary: isFree ? "اجرا بر روی Worker بدون هزینه" : `ورودی: ${p.input} / خروجی: ${p.output} به ازای ۱M توکن`,
    };
  }

  if (m === "auto" || m === "") {
    return {
      tier: "free",
      label: "هوشمند خودکار (Auto)",
      badgeClass: "free",
      inputPerMillion: "$0.00",
      outputPerMillion: "$0.00",
      summary: "انتخاب خودکار کم‌هزینه‌ترین مدل با بالاترین کارایی",
    };
  }

  if (!m.includes("/") || m.startsWith("ollama/") || m.includes("qwen") || m.includes("llama") || m.includes("mistral") || m.includes("deepseek-r1:1.5b") || m.includes("phi")) {
    if (!m.includes("openrouter/") && !m.includes("gemini/") && !m.includes("openai/") && !m.includes("anthropic/")) {
      return {
        tier: "free",
        label: "رایگان (Worker Local)",
        badgeClass: "free",
        inputPerMillion: "$0.00",
        outputPerMillion: "$0.00",
        summary: "اجرا بر روی منابع سخت‌افزاری محلی (بدون هزینه API)",
      };
    }
  }

  if (m.includes("flash") || m.includes("mini") || m.includes("deepseek-chat") || m.includes("8b") || m.includes("3b")) {
    return {
      tier: "ultra-low",
      label: "بسیار اقتصادی (~$0.08 / 1M)",
      badgeClass: "ultra-low",
      inputPerMillion: "$0.075",
      outputPerMillion: "$0.30",
      summary: "مناسب برای اجرای حجیم، سناریوهای تکراری و ابزارها",
    };
  }

  return {
    tier: "standard",
    label: "استاندارد Cloud",
    badgeClass: "standard",
    inputPerMillion: "$0.80",
    outputPerMillion: "$2.40",
    summary: "مدل‌های توانمند ابری با درک عمیق منطقی",
  };
}
