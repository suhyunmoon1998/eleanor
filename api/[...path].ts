import type { InjectOptions, Response as InjectResponse } from "light-my-request";
import { buildServerApp } from "../src/server/app.js";

let appPromise: ReturnType<typeof buildServerApp> | null = null;

function getApp() {
  appPromise ??= buildServerApp();
  return appPromise;
}

function responseHeaders(reply: InjectResponse) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(reply.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, String(item));
      continue;
    }
    if (typeof value !== "undefined") {
      headers.set(key, String(value));
    }
  }
  return headers;
}

export const config = {
  maxDuration: 60,
};

export default {
  async fetch(request: Request) {
    const app = await getApp();
    const url = new URL(request.url);
    const payload = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : Buffer.from(await request.arrayBuffer());
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const injectOptions: InjectOptions = {
      method: request.method as InjectOptions["method"],
      url: `${url.pathname}${url.search}`,
      headers,
      payload,
    };
    const reply = await app.inject(injectOptions);

    return new Response(reply.rawPayload as BodyInit, {
      status: reply.statusCode,
      headers: responseHeaders(reply),
    });
  },
};
