import { useState, useEffect } from "react";
import { api } from "../api";
import {
  OMNI_PALETTES,
  applyThemePalette,
  getActiveThemePalette,
  type OmniThemePalette,
} from "../design-system/tokens";

type Props = {
  isSuperadmin?: boolean;
  compact?: boolean;
  onPaletteChanged?: (palette: OmniThemePalette) => void;
};

export function ThemePaletteSelector({ isSuperadmin = true, compact = false, onPaletteChanged }: Props) {
  const [activePalette, setActivePalette] = useState<OmniThemePalette>(() => getActiveThemePalette());
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    // Initial fetch from backend to get system configured palette
    api.getTheme()
      .then((res) => {
        if (res.active_palette && res.active_palette in OMNI_PALETTES) {
          const p = res.active_palette as OmniThemePalette;
          setActivePalette(p);
          applyThemePalette(p);
        }
      })
      .catch(() => undefined);
  }, []);

  async function handleSelectPalette(paletteId: OmniThemePalette) {
    if (saving || paletteId === activePalette) return;
    setActivePalette(paletteId);
    applyThemePalette(paletteId);
    if (onPaletteChanged) onPaletteChanged(paletteId);

    if (isSuperadmin) {
      setSaving(true);
      setStatusMessage("در حال اعمال طیف رنگ روی سرور و کلاینت‌ها...");
      try {
        await api.setAdminTheme(paletteId);
        setStatusMessage(`طیف رنگ سراسری سیستم به «${OMNI_PALETTES[paletteId].name}» تغییر یافت.`);
        setTimeout(() => setStatusMessage(""), 4000);
      } catch (err: any) {
        setStatusMessage(err.message || "خطا در ذخیره تم روی سرور.");
      } finally {
        setSaving(false);
      }
    }
  }

  const palettes = Object.values(OMNI_PALETTES);

  if (compact) {
    return (
      <div className="theme-palette-compact flex items-center gap-2" title="تغییر طیف رنگ سراسری سیستم (وب، ویندوز، اندروید)">
        <span className="text-xs text-muted font-mono" style={{ opacity: 0.8 }}>طیف رنگ:</span>
        <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-full border border-white/10">
          {palettes.map((p) => {
            const isSelected = activePalette === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPalette(p.id)}
                disabled={saving}
                className={`w-5 h-5 rounded-full transition-all duration-200 relative ${
                  isSelected ? "scale-125 ring-2 ring-white ring-offset-1 ring-offset-black" : "opacity-70 hover:opacity-100 hover:scale-110"
                }`}
                style={{
                  background: p.gradient,
                  boxShadow: isSelected ? `0 0 10px ${p.primary}` : undefined,
                }}
                title={`${p.name} ${isSelected ? "(فعال)" : ""}`}
                aria-label={p.name}
              />
            );
          })}
        </div>
        {statusMessage && (
          <span className="text-xs text-brand animate-pulse font-mono mr-1">{statusMessage}</span>
        )}
      </div>
    );
  }

  return (
    <div className="theme-palette-card p-4 rounded-xl border border-white/10 bg-black/30 backdrop-blur-md">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
            <span>🎨</span>
            <span>طیف رنگی واحد و تم سراسری سیستم (Unified Theme Token)</span>
          </h4>
          <p className="text-xs text-muted mt-0.5">
            تغییر طیف رنگی در این بخش، فوراً تم پنل وب، کلاینت دسکتاپ ویندوز و اپلیکیشن موبایل/PWA را یکدست می‌کند.
          </p>
        </div>
        {saving && (
          <span className="text-xs text-brand animate-spin">⏳</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mt-3">
        {palettes.map((p) => {
          const isSelected = activePalette === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelectPalette(p.id)}
              disabled={saving}
              className={`p-3 rounded-lg border text-right transition-all flex flex-col justify-between gap-2 relative overflow-hidden ${
                isSelected
                  ? "border-brand bg-white/5 shadow-lg shadow-brand/10 ring-1 ring-brand"
                  : "border-white/10 bg-black/20 hover:border-white/30 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-xs font-medium text-foreground">{p.name}</span>
                {isSelected && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-brand/20 text-brand font-mono font-bold">فعال</span>
                )}
              </div>

              {/* Color swatch bar */}
              <div
                className="h-4 w-full rounded-md shadow-inner transition-transform"
                style={{ background: p.gradient }}
              />

              <div className="flex items-center justify-between text-[10px] text-muted font-mono mt-1">
                <span style={{ color: p.primary }}>● {p.primary}</span>
                <span style={{ color: p.accent }}>● {p.accent}</span>
              </div>
            </button>
          );
        })}
      </div>

      {statusMessage && (
        <div className="mt-3 text-xs p-2 rounded bg-brand/10 border border-brand/30 text-brand font-mono text-center">
          {statusMessage}
        </div>
      )}
    </div>
  );
}
