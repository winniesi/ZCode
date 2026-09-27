/* eslint-disable max-lines -- Web 远控中继协议、签名握手与 RPC 桥接集中收敛于单一连接模块 */
import { Emitter, VSBuffer, ChannelClient, type Event, type IDisposable } from "@zcode/rpc";
import { RemoteServiceAccess } from "@zcode/client";
import type { IServiceAccessor } from "@zcode/services";
import type { WebRemoteControlParams } from "./remoteParams.js";
import { wrapModelSelectionServiceWithFallback } from "./modelSelectionFallback.js";

const DEFAULT_RELAY_WS_URL = "wss://zcode.z.ai/ws";

function resolveRelayWsUrl(): string {
  const envUrl = import.meta.env.VITE_ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL?.trim();
  if (envUrl) {
    return envUrl;
  }
  const endpointOrigin = import.meta.env.VITE_ZCODE_BASE_URL?.trim();
  if (endpointOrigin) {
    return endpointOrigin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") + "/ws";
  }
  return DEFAULT_RELAY_WS_URL;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function calculateProof(
  passHash: string,
  nonce: string,
  role: string,
  deviceSid: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(passHash),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${nonce}|${role}|${deviceSid}`),
  );
  return base64url(new Uint8Array(signature));
}

function bufferToBase64(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i] ?? 0);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type WebRemoteRelayState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "waiting"
  | "paired"
  | "closed"
  | "error";

export interface WorkspaceBridgeInfo {
  bridgeSessionId: string;
  bridgeGeneration?: number;
  recoveryId?: string;
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  initialTaskId?: string;
  kind?: string;
}

export class WebRemoteRelayClient {
  private socket: WebSocket | null = null;
  private state: WebRemoteRelayState = "idle";
  private readonly stateChangeEmitter = new Emitter<WebRemoteRelayState>();
  private readonly appPayloadEmitter = new Emitter<any>();
  private nextRequestId = 1;
  private currentBridge: WorkspaceBridgeInfo | null = null;
  private relayRpcProtocol: RelayRpcProtocol | null = null;
  private heartbeatTimer: any = null;

  readonly onStateChange: Event<WebRemoteRelayState> = this.stateChangeEmitter.event;
  readonly onAppPayload: Event<any> = this.appPayloadEmitter.event;

  constructor(private readonly params: WebRemoteControlParams) {}

  getState(): WebRemoteRelayState {
    return this.state;
  }

  private setState(next: WebRemoteRelayState) {
    if (this.state !== next) {
      this.state = next;
      this.stateChangeEmitter.fire(next);
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState("connecting");
      const baseWsUrl = resolveRelayWsUrl();
      const url = new URL(baseWsUrl);
      if (this.params.deviceMid?.trim()) {
        url.searchParams.set("mid", this.params.deviceMid.trim());
      }

      console.info("[web-remote] connecting to relay:", url.toString());
      const ws = new WebSocket(url.toString());
      this.socket = ws;

      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
      };

      const onOpen = () => {
        cleanup();
        this.setState("authenticating");
        this.send({
          type: "auth_init",
          role: "terminal",
          device_sid: this.params.deviceSid,
          meta: {
            platform: "web",
            version: this.params.appVersion ?? "web",
            name: "mobile-browser",
          },
          client_ts: Date.now(),
        });
        resolve();
      };

      const onError = (_e: any) => {
        cleanup();
        this.setState("error");
        reject(new Error("Failed to connect to Web remote control relay"));
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("message", (event) => this.handleMessage(event.data));
      ws.addEventListener("close", (event) => {
        console.warn("[web-remote] relay ws closed", event.code, event.reason);
        this.stopHeartbeat();
        this.setState("closed");
      });
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: "pair_status_query",
        device_sid: this.params.deviceSid,
        client_ts: Date.now(),
      });
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(data: object) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  sendPayload(payload: object) {
    this.send({
      type: "data",
      payload,
      client_ts: Date.now(),
    });
  }

  async requestAppPayload<T = any>(
    request: { zcode_type: string; requestId?: string; [k: string]: any },
    predicate: (msg: any) => boolean,
    timeoutMs = 15000,
  ): Promise<T> {
    const requestId = request.requestId ?? `req-${this.nextRequestId++}-${Date.now()}`;
    const fullRequest = { ...request, requestId };

    return new Promise((resolve, reject) => {
      let timeoutTimer: any;

      const sub = this.onAppPayload((payload: any) => {
        if (payload?.requestId === requestId || predicate(payload)) {
          clearTimeout(timeoutTimer);
          sub.dispose();
          resolve(payload);
        }
      });

      timeoutTimer = setTimeout(() => {
        sub.dispose();
        reject(new Error(`Timeout waiting for response to ${request.zcode_type}`));
      }, timeoutMs);

      this.sendPayload(fullRequest);
    });
  }

  private async handleMessage(raw: any) {
    let msg: any;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return;
    }

    switch (msg.type) {
      case "auth_challenge": {
        const proof = await calculateProof(
          this.params.passHash,
          msg.nonce,
          "terminal",
          this.params.deviceSid,
        );
        this.send({
          type: "auth_response",
          device_sid: this.params.deviceSid,
          proof,
          client_ts: Date.now(),
        });
        break;
      }
      case "auth_ack":
      case "pair_status_ack": {
        const status = msg.pair_status;
        if (status === "matched") {
          this.setState("paired");
          this.startHeartbeat();
        } else if (status === "waiting") {
          this.setState("waiting");
        }
        break;
      }
      case "data": {
        this.handleDataPayload(msg.payload);
        break;
      }
      case "error": {
        console.error("[web-remote] relay error:", msg.code, msg.message);
        this.setState("error");
        break;
      }
    }
  }

  private handleDataPayload(payload: any) {
    if (!payload || typeof payload !== "object") return;

    if (payload.zcode_type === "rpc-frame" || payload.zcode_type === "rpc-frame-ack") {
      this.relayRpcProtocol?.acceptPayload(payload);
      return;
    }

    this.appPayloadEmitter.fire(payload);
  }

  async openWorkspaceBridge(
    workspaceKey: string,
    taskId?: string,
  ): Promise<{
    bridge: WorkspaceBridgeInfo;
    services: IServiceAccessor;
  }> {
    const bridgeSessionId = `bridge-${this.nextRequestId++}-${Date.now()}`;
    const requestId = `open-${bridgeSessionId}`;

    const readyResp = await this.requestAppPayload(
      {
        zcode_type: "workspace-bridge-open",
        requestId,
        bridgeSessionId,
        bridgeGeneration: 1,
        workspaceKey,
        ...(taskId ? { taskId } : {}),
      },
      (p) => p.zcode_type === "workspace-bridge-ready" && p.bridgeSessionId === bridgeSessionId,
      20000,
    );

    const bridge: WorkspaceBridgeInfo = readyResp.bridge;
    this.currentBridge = bridge;

    this.sendPayload({
      zcode_type: "mobile-view-state-update",
      viewState: {
        activeWorkspaceKey: workspaceKey,
        ...(taskId ? { activeTaskId: taskId } : {}),
        updatedAt: Date.now(),
      },
      deviceInfo: {
        platform: "web",
        version: this.params.appVersion ?? "web",
      },
    });

    const protocol = new RelayRpcProtocol(this, bridge);
    this.relayRpcProtocol = protocol;

    const channelClient = new ChannelClient(protocol);
    const rawServices = new RemoteServiceAccess(channelClient);

    const wrappedModelSelection = wrapModelSelectionServiceWithFallback(
      rawServices.modelSelectionService,
    );

    const proxiedServices = new Proxy(rawServices, {
      get(target, prop, receiver) {
        if (prop === "modelSelectionService") {
          return wrappedModelSelection;
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    return {
      bridge,
      services: proxiedServices as IServiceAccessor,
    };
  }

  dispose() {
    this.stopHeartbeat();
    this.relayRpcProtocol?.dispose();
    this.socket?.close();
    this.socket = null;
    this.setState("closed");
  }
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

function calculateCrc32(bytes: Uint8Array): string {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ b) & 0xff] ?? 0);
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, "0");
}

class RelayRpcProtocol implements IDisposable {
  private readonly onMessageEmitter = new Emitter<VSBuffer>();
  private nextPhysicalSeq = 1;
  private nextMessageSeq = 1;
  private disposed = false;

  readonly onMessage: Event<VSBuffer> = this.onMessageEmitter.event;

  constructor(
    private readonly client: WebRemoteRelayClient,
    private readonly bridge: WorkspaceBridgeInfo,
  ) {}

  send(buffer: VSBuffer): void {
    if (this.disposed) return;
    const bytes = buffer.buffer;
    const base64 = bufferToBase64(bytes);
    const crc32Hex = calculateCrc32(bytes);

    const frame: Record<string, any> = {
      zcode_type: "rpc-frame",
      bridgeSessionId: this.bridge.bridgeSessionId,
      seq: this.nextPhysicalSeq++,
      messageSeq: this.nextMessageSeq++,
      fragmentIndex: 0,
      fragmentCount: 1,
      messageBytes: bytes.byteLength,
      checksum: {
        algorithm: "crc32",
        value: crc32Hex,
      },
      dataBase64: base64,
    };

    if (this.bridge.bridgeGeneration !== undefined) {
      frame["bridgeGeneration"] = this.bridge.bridgeGeneration;
    }
    if (this.bridge.recoveryId) {
      frame["recoveryId"] = this.bridge.recoveryId;
    }

    this.client.sendPayload(frame);
  }

  drain(): Promise<void> {
    return Promise.resolve();
  }

  acceptPayload(payload: any): void {
    if (this.disposed || !payload) return;
    if (payload.bridgeSessionId !== this.bridge.bridgeSessionId) return;

    if (payload.zcode_type === "rpc-frame" && typeof payload.dataBase64 === "string") {
      const bytes = base64ToBuffer(payload.dataBase64);
      this.onMessageEmitter.fire(VSBuffer.wrap(bytes));

      const ackSeq = payload.messageSeq ?? payload.seq;
      if (typeof ackSeq === "number") {
        const ack: Record<string, any> = {
          zcode_type: "rpc-frame-ack",
          bridgeSessionId: this.bridge.bridgeSessionId,
          ackMessageSeq: ackSeq,
        };
        if (this.bridge.bridgeGeneration !== undefined) {
          ack["bridgeGeneration"] = this.bridge.bridgeGeneration;
        }
        if (this.bridge.recoveryId) {
          ack["recoveryId"] = this.bridge.recoveryId;
        }
        this.client.sendPayload(ack);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.onMessageEmitter.dispose();
  }
}
