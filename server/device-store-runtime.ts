import { Redis } from "@upstash/redis";
import { DeviceStore } from "./device-store.js";

let store: DeviceStore | undefined;

export function environmentName(): string {
  return (
    process.env.APP_ENV ??
    process.env.VERCEL_TARGET_ENV ??
    process.env.VERCEL_ENV ??
    "development"
  ).replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

export function deviceStore(): DeviceStore {
  if (!store) {
    store = new DeviceStore(
      Redis.fromEnv({
        automaticDeserialization: false,
        enableTelemetry: false,
        readYourWrites: true,
        retry: false,
      }),
      `strijders:${environmentName()}:devices:v1`,
    );
  }
  return store;
}
