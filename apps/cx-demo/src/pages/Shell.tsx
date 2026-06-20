import type { FC, PropsWithChildren } from 'hono/jsx';

type ShellProps = PropsWithChildren<{
  title?: string;
  activeTab?: 'tickets' | 'conversas' | 'clientes';
}>;

const TABS = [
  { key: 'tickets', label: 'Tickets', href: '/tickets', icon: '🎫' },
  { key: 'conversas', label: 'Conversas', href: '/conversas', icon: '💬' },
  { key: 'clientes', label: 'Clientes', href: '/clientes', icon: '👥' },
] as const;

export const Shell: FC<ShellProps> = ({ title, activeTab, children }) => (
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} · Onyx CX` : 'Onyx CX'}</title>
      <script src="https://cdn.tailwindcss.com" />
      <script src="https://unpkg.com/htmx.org@1.9.12" />
      <script src="https://unpkg.com/htmx.org@1.9.12/dist/ext/sse.js" />
      <style>{`
        body { background: #0a0e14; color: #e6edf3; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .live-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 0 3px rgba(16,185,129,.18); animation: pulse 2s infinite; }
        .live-dot.off { background:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.18); animation:none; }
        @keyframes pulse { 0%,100% {opacity:1} 50% {opacity:.5} }
        .scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 3px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: #374151; }
        .drawer-enter { animation: drawerIn 0.2s ease-out; }
        @keyframes drawerIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </head>
    <body class="min-h-screen flex flex-col">
      <header class="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-30 shadow-lg shadow-black/20">
        <div class="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
          <div class="flex items-center gap-8">
            <a href="/" class="flex items-center gap-2 font-bold tracking-tight hover:opacity-80 transition">
              <span class="text-cyan-400 text-lg">◆</span>
              <span class="text-base">Onyx <span class="text-gray-400 font-normal">CX</span></span>
            </a>
            <nav class="flex items-center gap-1">
              {TABS.map((t) => (
                <a
                  href={t.href}
                  class={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    activeTab === t.key
                      ? 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                  }`}
                >
                  <span class="mr-1.5 text-xs">{t.icon}</span>
                  {t.label}
                </a>
              ))}
            </nav>
          </div>
          <div class="flex items-center gap-5">
            <div class="flex items-center gap-2 text-xs text-gray-400">
              <span class="live-dot" id="live-dot" />
              <span id="live-label" class="font-medium">live</span>
            </div>
            <div class="flex items-center gap-3 border-l border-gray-800 pl-5 h-7">
              <div class="flex items-center gap-2 h-full">
                <div class="w-7 h-7 rounded-full bg-cyan-500/20 ring-1 ring-cyan-500/40 flex items-center justify-center text-cyan-300 font-semibold text-[11px] leading-none">
                  CX
                </div>
                <span class="text-xs text-gray-300 font-medium leading-none">Atendente CX</span>
              </div>
              <form method="post" action="/logout" class="h-full flex items-center">
                <button
                  type="submit"
                  title="Sair do painel"
                  class="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs leading-none text-gray-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition border border-transparent hover:border-red-500/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Sair</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>
      <main class="flex-1 max-w-7xl mx-auto w-full px-6 py-6">
        <div
          id="sse-listener"
          hx-ext="sse"
          sse-connect="/events"
          hx-on--htmx-sse-open="document.getElementById('live-dot').classList.remove('off'); document.getElementById('live-label').textContent='live';"
          hx-on--htmx-sse-error="document.getElementById('live-dot').classList.add('off'); document.getElementById('live-label').textContent='offline';"
        >
          {children}
        </div>
      </main>
      <div id="toast-rail" class="fixed bottom-4 right-4 flex flex-col gap-2 z-50" />
    </body>
  </html>
);
