export interface Env {
  port: number;
  host: string;
  databaseUrl: string | undefined;
  signingSecret: string;
  storageDir: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: Number(env.LATHE_PORT ?? 8787),
    host: env.LATHE_HOST ?? "127.0.0.1",
    databaseUrl: env.DATABASE_URL,
    signingSecret: env.LATHE_SIGNING_SECRET ?? "",
    storageDir: env.LATHE_STORAGE_DIR ?? joinDefault(),
  };
}

function joinDefault(): string {
  return ".data/storage";
}

export function validateEnv(e: Env): string[] {
  const problems: string[] = [];
  if (!e.signingSecret) problems.push("LATHE_SIGNING_SECRET is required for signed media URLs");
  return problems;
}
