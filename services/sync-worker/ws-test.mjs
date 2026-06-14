// Quick manual check: two devices on one user, A pushes, B should receive it.
const BASE = "http://localhost:8787";
const email = "ws-test@example.com";

const reqRes = await (await fetch(`${BASE}/auth/request`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
})).json();
const verify = await (await fetch(`${BASE}/auth/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, code: reqRes.code }),
})).json();
const token = verify.token;

const wsUrl = (device) =>
  `ws://localhost:8787/ws?token=${encodeURIComponent(token)}&device=${device}`;

function connect(device) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl(device));
    ws.addEventListener("open", () => resolve(ws));
  });
}

const a = await connect("device-A");
const b = await connect("device-B");

let received = null;
b.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "sync") received = msg;
});

const note = {
  id: "ws-note-1",
  content: "pushed from A",
  color: "green",
  posX: 100, posY: 100, width: 280, height: 280,
  pinned: false, alwaysOnTop: false, archived: false, deleted: false,
  updatedAt: Date.now(),
};
a.send(JSON.stringify({ type: "push", ops: [{ opId: "op1", deviceId: "device-A", note }] }));

await new Promise((r) => setTimeout(r, 800));

console.log("B received broadcast:", JSON.stringify(received));

// And B can pull from scratch.
b.send(JSON.stringify({ type: "pull", since: 0 }));
let pulled = null;
b.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "sync" && msg.notes.some((n) => n.id === "ws-note-1")) pulled = msg;
});
await new Promise((r) => setTimeout(r, 600));
console.log("B pull contains note:", pulled ? "YES" : "NO");

a.close();
b.close();
console.log(received && pulled ? "WS_TEST_PASS" : "WS_TEST_FAIL");
process.exit(received && pulled ? 0 : 1);
