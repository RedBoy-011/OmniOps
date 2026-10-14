/**
 * OmniOps Unified Design System Tokens (TypeScript)
 * Windows Edge Agent Client
 */

export const OMNI_COLORS = {
  brand: {
    cyan: "#00f0ff",
    emerald: "#00ffaa",
    mint: "#5eead4",
    gradient: "linear-gradient(135deg, #00f0ff 0%, #00ffaa 100%)",
  },
  status: {
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#06b6d4",
  },
  dark: {
    bgApp: "#0a0f1d",
    bgSurface: "rgba(15, 23, 42, 0.75)",
    border: "rgba(255, 255, 255, 0.10)",
    textPrimary: "#f8fafc",
    textSecondary: "#94a3b8",
  },
  light: {
    bgApp: "#f8fafc",
    bgSurface: "rgba(255, 255, 255, 0.85)",
    border: "rgba(15, 23, 42, 0.10)",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
  },
} as const;

export type ModelCostTier = "free" | "ultra-low" | "low" | "standard" | "premium";

export interface ModelCostEstimate {
  tier: ModelCostTier;
  label: string;
  badgeClass: string;
  inputPerMillion: string;
  outputPerMillion: string;
  summary: string;
}

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
      summary: "تقریباً ۰٫۰۸ دلار به ازای هر ۱ میلیون توکن",
    };
  }

  if (m.includes("3.5-turbo") || m.includes("haiku") || m.includes("70b") || m.includes("command-r")) {
    return {
      tier: "low",
      label: "اقتصادی (~$0.50 / 1M)",
      badgeClass: "low",
      inputPerMillion: "$0.50",
      outputPerMillion: "$1.50",
      summary: "تقریباً ۰٫۵۰ دلار به ازای هر ۱ میلیون توکن",
    };
  }

  if (m.includes("pro") || m.includes("gpt-4o") || m.includes("sonnet")) {
    return {
      tier: "standard",
      label: "متوسط استاندارد (~$2.50 / 1M)",
      badgeClass: "standard",
      inputPerMillion: "$2.50",
      outputPerMillion: "$10.00",
      summary: "حدود ۲٫۵۰ دلار ورودی / ۱۰ دلار خروجی به ازای هر ۱ میلیون توکن",
    };
  }

  return {
    tier: "low",
    label: "معمولی (~$0.40 / 1M)",
    badgeClass: "low",
    inputPerMillion: "$0.40",
    outputPerMillion: "$1.20",
    summary: "تعرفه ابری استاندارد",
  };
}
