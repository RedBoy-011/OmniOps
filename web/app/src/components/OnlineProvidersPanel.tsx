import React, { useState } from 'react';

interface ApiKeyItem {
  id: string;
  label: string;
  maskedKey: string;
  usage: number;
  status: 'active' | 'rate_limited' | 'error';
}

interface ProviderItem {
  id: string;
  name: string;
  logo: string;
  defaultModel: string;
  keys: ApiKeyItem[];
}

export const OnlineProvidersPanel: React.FC = () => {
  const [providers, setProviders] = useState<ProviderItem[]>([
    {
      id: 'deepseek',
      name: 'DeepSeek Cloud',
      logo: '🐋',
      defaultModel: 'deepseek-chat',
      keys: [
        { id: '1', label: 'اکانت اصلی پروژه', maskedKey: 'sk-d98f••••••••7a1b', usage: 1420, status: 'active' },
        { id: '2', label: 'کلید یدکی دوم (Failover)', maskedKey: 'sk-41ea••••••••99c2', usage: 85, status: 'active' },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI (ChatGPT)',
      logo: '🟢',
      defaultModel: 'gpt-4o-mini',
      keys: [
        { id: '3', label: 'سهمیه ماهانه شرکت', maskedKey: 'sk-proj-••••••••e190', usage: 890, status: 'active' },
      ],
    },
    {
      id: 'gemini',
      name: 'Google Gemini Pro',
      logo: '✨',
      defaultModel: 'gemini-1.5-flash',
      keys: [
        { id: '4', label: 'کلید رایگان Gemini Flash', maskedKey: 'AIzaSy••••••••8b91', usage: 320, status: 'active' },
      ],
    },
  ]);

  const [selectedProvider, setSelectedProvider] = useState<string>('deepseek');
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleAddKey = () => {
    if (!newKey.trim() || !newLabel.trim()) return;

    setProviders((prev) =>
      prev.map((p) => {
        if (p.id === selectedProvider) {
          const masked = `${newKey.slice(0, 7)}••••••••${newKey.slice(-4)}`;
          return {
            ...p,
            keys: [
              ...p.keys,
              {
                id: Date.now().toString(),
                label: newLabel,
                maskedKey: masked,
                usage: 0,
                status: 'active',
              },
            ],
          };
        }
        return p;
      })
    );

    setNewKey('');
    setNewLabel('');
    setStatusMsg('✅ کلید جدید با موفقیت اضافه شد و در چرخه توازن بار (Load Balancing) قرار گرفت.');
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleRemoveKey = (providerId: string, keyId: string) => {
    setProviders((prev) =>
      prev.map((p) =>
        p.id === providerId ? { ...p, keys: p.keys.filter((k) => k.id !== keyId) } : p
      )
    );
  };

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 text-white max-w-3xl mx-auto shadow-2xl">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#30363d]">
        <div>
          <h3 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
            <span>🌐</span> مدیریت مدل‌ها و کلیدهای آنلاین ابری (Multi-Provider AI)
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            افزودن چندین API Key برای هر سرویس همراه با سوئیچ خودکار در زمان بروز خطا یا اتمام سهمیه
          </p>
        </div>
        <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full font-mono">
          چرخش هوشمند کلیدها: فعال ✅
        </span>
      </div>

      {statusMsg && (
        <div className="p-2.5 mb-3 rounded-xl bg-[#0d1117] text-xs text-emerald-400 border border-emerald-800/40">
          {statusMsg}
        </div>
      )}

      <div className="space-y-3 mb-5">
        {providers.map((p) => (
          <div key={p.id} className="p-3.5 rounded-xl bg-[#0d1117] border border-[#21262d]">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{p.logo}</span>
                <span className="font-bold text-xs text-gray-200">{p.name}</span>
                <span className="text-[10px] bg-[#161b22] border border-[#30363d] text-cyan-300 px-2 py-0.2 rounded font-mono">
                  مدل پیش‌فرض: {p.defaultModel}
                </span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono">
                {p.keys.length} کلید متصل
              </span>
            </div>

            <div className="space-y-1.5 pl-6">
              {p.keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-[#161b22] border border-[#262c36] text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300 font-medium">{k.label}:</span>
                    <span className="font-mono text-gray-400">{k.maskedKey}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-500 font-mono">استفاده: {k.usage} بار</span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950 px-1.5 py-0.2 rounded font-mono">
                      آماده
                    </span>
                    <button
                      onClick={() => handleRemoveKey(p.id, k.id)}
                      className="text-gray-500 hover:text-red-400 text-xs"
                      title="حذف کلید"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl bg-[#0d1117] border border-[#21262d] space-y-3">
        <span className="font-bold text-xs text-gray-200 block">+ افزودن کلید جدید به ارائه‌دهنده:</span>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div>
            <label className="text-[10px] text-gray-400 block mb-1">ارائه‌دهنده:</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-2.5 py-2 text-white outline-none"
            >
              <option value="deepseek">DeepSeek (توصیه اقتصادی)</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter (همه مدل‌ها)</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-gray-400 block mb-1">عنوان کلید (توضیحات):</label>
            <input
              type="text"
              placeholder="مثلا: کلید سرور پشتیبان"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-2.5 py-2 text-white outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-[10px] text-gray-400 block mb-1">مقدار API Key:</label>
            <input
              type="password"
              placeholder="sk-••••••••••••••••"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-2.5 py-2 text-white outline-none focus:border-cyan-500 font-mono"
            />
          </div>
        </div>

        <button
          onClick={handleAddKey}
          disabled={!newKey.trim() || !newLabel.trim()}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium py-2 rounded-xl text-xs transition shadow-lg shadow-cyan-950"
        >
          ثبت و الحاق کلید به چرخه هوش مصنوعی
        </button>
      </div>
    </div>
  );
};
