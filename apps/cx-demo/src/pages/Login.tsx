import type { FC } from 'hono/jsx';

export const Login: FC<{ error?: string }> = ({ error }) => (
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Login · Onyx CX</title>
      <script src="https://cdn.tailwindcss.com" />
      <style>{`body { background:#0b0f14; color:#e6edf3; }`}</style>
    </head>
    <body class="min-h-screen flex items-center justify-center">
      <form
        method="post"
        action="/login"
        class="bg-gray-900 border border-gray-800 rounded-lg p-8 w-full max-w-sm shadow-xl"
      >
        <h1 class="text-2xl font-bold mb-1">
          <span class="text-cyan-400">Onyx</span> CX Painel
        </h1>
        <p class="text-sm text-gray-400 mb-6">Acesso restrito ao time de CX da Onyx Telecom.</p>
        {error ? <div class="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2 mb-4">{error}</div> : null}
        <label class="block text-sm text-gray-300 mb-1">Senha</label>
        <input
          type="password"
          name="password"
          autocomplete="current-password"
          required
          class="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 mb-4"
        />
        <button
          type="submit"
          class="w-full bg-cyan-500 hover:bg-cyan-400 text-gray-900 font-semibold rounded px-3 py-2 text-sm transition"
        >
          Entrar
        </button>
        <div class="mt-4 pt-3 border-t border-gray-800 flex items-center justify-center gap-2 text-[11px] text-gray-500">
          <span class="text-base">🔑</span>
          <span>
            Senha demo: <span class="font-mono text-cyan-400/80 select-all">onyx-demo</span>
          </span>
        </div>
        <div class="mt-2 text-center text-[10px] text-gray-600">
          Visível apenas em deploy de avaliação · Onyx Telecom (fictícia)
        </div>
      </form>
    </body>
  </html>
);
