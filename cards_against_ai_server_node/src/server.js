/**
 * Cards Against AI server (reset).
 *
 * Starting point for a new implementation.
 */
import { createServer } from "node:http";
const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;
const httpServer = createServer((req, res) => {
    res.writeHead(501, { "Content-Type": "text/plain" });
    res.end("Cards Against AI server is not implemented yet.");
});
httpServer.on("clientError", (err, socket) => {
    console.error("HTTP client error", err);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});
httpServer.listen(port, () => {
    console.log(`Cards Against AI server listening on http://localhost:${port}`);
});
