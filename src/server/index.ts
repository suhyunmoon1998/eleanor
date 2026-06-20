import { buildServerApp } from "./app.js";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "0.0.0.0";

const app = await buildServerApp({ serveStatic: true });

await app.listen({ host, port });
