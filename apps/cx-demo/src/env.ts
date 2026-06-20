export const env = {
  port: Number(process.env.PORT ?? '3000'),
  databaseUrl: process.env.KHAL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/omni',
  token: process.env.CX_DEMO_TOKEN ?? '',
  password: process.env.CX_DEMO_PASSWORD ?? 'onyx-demo',
  sessionSecret: process.env.CX_DEMO_SESSION_SECRET ?? process.env.CX_DEMO_TOKEN ?? 'change-me',
  natsUrl: process.env.NATS_URL ?? 'nats://localhost:4222',
  omniInstanceId: process.env.OMNI_INSTANCE_ID ?? '',
  cxDemoExternalUrl: process.env.CX_DEMO_EXTERNAL_URL ?? '',
} as const;

if (!env.token) {
  console.warn('[cx-demo] WARNING: CX_DEMO_TOKEN not set — API endpoints reject all requests');
}
