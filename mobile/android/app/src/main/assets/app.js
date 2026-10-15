// OmniOps Mobile Companion Controller
document.addEventListener("DOMContentLoaded", () => {
  const serverInput = document.getElementById("serverUrlInput");
  const btnConnect = document.getElementById("btnConnect");
  const btnBiometric = document.getElementById("btnBiometricAuth");
  const authResult = document.getElementById("authResult");
  const floatingToggle = document.getElementById("floatingToggle");
  const btnKillSwitch = document.getElementById("btnKillSwitch");

  // Load saved server URL
  if (window.OmniOpsBridge && typeof window.OmniOpsBridge.getServerUrl === "function") {
    const saved = window.OmniOpsBridge.getServerUrl();
    if (saved) serverInput.value = saved;
  }

  // Connect button
  btnConnect.addEventListener("click", () => {
    const url = serverInput.value.trim();
    if (!url) {
      alert("لطفاً آدرس معتبر سرور را وارد کنید.");
      return;
    }
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.setServerUrl === "function") {
      window.OmniOpsBridge.setServerUrl(url);
    } else {
      window.location.href = url;
    }
  });

  // Biometric Auth callback handler
  window.onBiometricResult = (success, message) => {
    if (success) {
      authResult.innerHTML = '<span style="color:#10b981;font-weight:bold;">✅ هویت تأیید شد: فرمان ارسال و اجرا گردید.</span>';
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(50);
      }
    } else {
      authResult.innerHTML = `<span style="color:#f43f5e;font-weight:bold;">❌ احراز هویت ناموفق بود (${message})</span>`;
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(200);
      }
    }
  };

  btnBiometric.addEventListener("click", () => {
    authResult.innerText = "در حال احراز هویت با حسگر بیومتریک...";
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.authenticateBiometric === "function") {
      window.OmniOpsBridge.authenticateBiometric(
        "تأیید اقدام امنیتی ایجنت",
        "برای اجرای فرمان حساس، اثر انگشت خود را اسکن نمایید",
        "window.onBiometricResult"
      );
    } else {
      // Browser preview fallback
      setTimeout(() => {
        window.onBiometricResult(true, "Web simulator");
      }, 600);
    }
  });

  // Floating Island Toggle
  floatingToggle.addEventListener("change", (e) => {
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.toggleFloatingService === "function") {
      window.OmniOpsBridge.toggleFloatingService(e.target.checked);
    }
  });

  // Kill Switch
  btnKillSwitch.addEventListener("click", () => {
    if (!confirm("آیا از توقف اضطراری تمام ایجنت‌ها اطمینان دارید؟")) return;
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
      window.OmniOpsBridge.showToast("🛑 سیگنال توقف اضطراری (Kill-Switch) ارسال شد.");
      window.OmniOpsBridge.vibrateDevice(400);
    } else {
      alert("🛑 سیگنال توقف اضطراری صادر شد.");
    }
  });
});
