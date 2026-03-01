/* eslint-disable no-console */
import { Socket } from "node:net";

interface CheckResult {
  name: string;
  ok: boolean;
  details: string;
}

async function checkHttp(name: string, url: string): Promise<CheckResult> {
  try {
    const response = await fetch(url);
    return {
      name,
      ok: response.ok,
      details: `status=${response.status}`
    };
  } catch (error) {
    return {
      name,
      ok: false,
      details: error instanceof Error ? error.message : "unknown_error"
    };
  }
}

function checkTcp(name: string, host: string, port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (ok: boolean, details: string) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({ name, ok, details });
    };

    socket.setTimeout(1500);
    socket.on("connect", () => finish(true, "connected"));
    socket.on("timeout", () => finish(false, "timeout"));
    socket.on("error", (error) => finish(false, error.message));
    socket.connect(port, host);
  });
}

async function runDoctor(): Promise<void> {
  const apiUrl = process.env.DOCTOR_API_URL ?? "http://localhost:8080/health";
  const webUrl = process.env.DOCTOR_WEB_URL ?? "http://localhost:3000/";
  const redisHost = process.env.REDIS_HOST ?? "127.0.0.1";
  const redisPort = Number(process.env.REDIS_PORT ?? "6379");
  const postgresHost = process.env.POSTGRES_HOST ?? "127.0.0.1";
  const postgresPort = Number(process.env.POSTGRES_PORT ?? "5432");

  const checks = await Promise.all([
    checkHttp("api_health", apiUrl),
    checkHttp("web_health", webUrl),
    checkTcp("redis_tcp", redisHost, redisPort),
    checkTcp("postgres_tcp", postgresHost, postgresPort)
  ]);

  let hasFailure = false;
  for (const check of checks) {
    if (!check.ok) {
      hasFailure = true;
    }
    console.log(`${check.ok ? "OK" : "FAIL"} ${check.name} ${check.details}`);
  }

  if (hasFailure) {
    process.exit(1);
  }
}

void runDoctor();
