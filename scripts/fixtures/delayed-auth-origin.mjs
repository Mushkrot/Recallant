import { createServer } from "node:http";

const delayMs = Number(process.argv[2] ?? "1500");
if (!Number.isFinite(delayMs) || delayMs < 0) {
  throw new Error(`Invalid delay: ${process.argv[2]}`);
}

const server = createServer((_request, response) => {
  setTimeout(() => {
    response.writeHead(401, {
      connection: "close",
      "content-type": "text/plain"
    });
    response.end("auth required");
  }, delayMs);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  process.stdout.write(`${address.port}\n`);
});

process.on("SIGTERM", () => process.exit(0));
