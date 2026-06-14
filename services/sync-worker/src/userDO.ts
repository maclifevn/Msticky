import { DurableObject } from "cloudflare:workers";
import { clientMessageSchema, type ServerMessage } from "@msticky/shared";
import type { Env } from "./env";
import { notesSince, upsertNote } from "./notesRepo";

/**
 * One instance per user (keyed by user id). Holds every connected device's
 * WebSocket, applies incoming ops to D1 with last-write-wins, and fans changes
 * out to the user's other devices. Uses hibernatable WebSockets so an idle user
 * costs nothing while staying instantly reachable.
 */
export class UserDO extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const userId = url.searchParams.get("uid");
    if (!userId) return new Response("missing user", { status: 400 });
    const deviceId = url.searchParams.get("did") ?? crypto.randomUUID();

    // Remember which user this DO serves (its id is derived from the user id).
    await this.ctx.storage.put("userId", userId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Tag the socket with the device id so we never echo an op to its origin.
    this.ctx.acceptWebSocket(server, [deviceId]);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const userId = await this.ctx.storage.get<string>("userId");
    if (!userId) return this.send(ws, { type: "error", message: "no session" });

    let msg;
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      msg = clientMessageSchema.parse(JSON.parse(text));
    } catch {
      return this.send(ws, { type: "error", message: "bad message" });
    }

    if (msg.type === "ping") {
      return this.send(ws, { type: "pong" });
    }

    if (msg.type === "pull") {
      const notes = await notesSince(this.env, userId, msg.since);
      return this.send(ws, { type: "sync", notes });
    }

    // push: persist with LWW, ack the sender, broadcast to other devices.
    for (const op of msg.ops) {
      await upsertNote(this.env, userId, op.note);
    }
    this.send(ws, { type: "ack", opIds: msg.ops.map((o) => o.opId) });

    const senderTag = this.ctx.getTags(ws)[0];
    const notes = msg.ops.map((o) => o.note);
    for (const peer of this.ctx.getWebSockets()) {
      if (this.ctx.getTags(peer)[0] === senderTag) continue;
      this.send(peer, { type: "sync", notes });
    }
  }

  webSocketClose(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }
}
