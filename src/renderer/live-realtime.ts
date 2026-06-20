type LiveRealtimeCallbacks = {
  onAssistantTranscript: (text: string) => void;
  onUserTranscript: (text: string) => void;
  onStatus: (text: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onError: (message: string) => void;
};

type ConnectOptions = {
  createRealtimeSession: (offerSdp: string) => Promise<string>;
  inputDeviceId?: string;
};

export class LiveRealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private assistantText = "";
  private connected = false;

  constructor(private readonly callbacks: LiveRealtimeCallbacks) {}

  async connect(options: ConnectOptions) {
    if (this.connected) return;

    try {
      this.callbacks.onStatus("Requesting microphone and connecting…");

      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.remoteAudio = new Audio();
      this.remoteAudio.autoplay = true;
      pc.ontrack = (event) => {
        if (this.remoteAudio) {
          this.remoteAudio.srcObject = event.streams[0] ?? null;
        }
      };

      pc.onconnectionstatechange = () => {
        if (!this.pc) return;
        const state = this.pc.connectionState;
        if (state === "connected") {
          this.connected = true;
          this.callbacks.onConnectionChange(true);
          this.callbacks.onStatus("Connected live. Eleanor is listening and speaking.");
        } else if (state === "failed" || state === "disconnected" || state === "closed") {
          this.callbacks.onConnectionChange(false);
          if (state !== "closed") {
            this.callbacks.onStatus(`Realtime connection ${state}.`);
          }
        }
      };

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: options.inputDeviceId
          ? { deviceId: { exact: options.inputDeviceId } }
          : true,
      });
      this.stream.getTracks().forEach((track) => pc.addTrack(track, this.stream!));

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onopen = () => {
        this.connected = true;
        this.callbacks.onConnectionChange(true);
        this.callbacks.onStatus("Connected live. Eleanor is ready.");
      };
      dc.onerror = () => {
        this.callbacks.onError("Realtime data-channel error.");
      };
      dc.onmessage = (event) => {
        try {
          this.handleEvent(JSON.parse(String(event.data)));
        } catch {
          this.callbacks.onError("Received an unreadable Realtime event.");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answerSdp = await options.createRealtimeSession(offer.sdp ?? "");
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  disconnect() {
    try {
      this.dc?.close();
      this.pc?.close();
      this.stream?.getTracks().forEach((track) => track.stop());
    } finally {
      this.pc = null;
      this.dc = null;
      this.stream = null;
      this.remoteAudio = null;
      this.assistantText = "";
      this.connected = false;
      this.callbacks.onConnectionChange(false);
      this.callbacks.onStatus("Live connection closed.");
    }
  }

  sendText(text: string, requestResponse = true) {
    if (!this.connected || this.dc?.readyState !== "open") {
      throw new Error("The live session is not connected.");
    }
    this.dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );
    if (requestResponse) {
      this.dc.send(JSON.stringify({ type: "response.create" }));
    }
  }

  requestAssistantReply(instructions: string) {
    this.sendText(instructions, true);
  }

  isConnected() {
    return this.connected;
  }

  private handleEvent(event: Record<string, unknown>) {
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "response.output_audio_transcript.delta") {
      this.assistantText += typeof event.delta === "string" ? event.delta : "";
      return;
    }

    if (type === "response.output_audio_transcript.done") {
      const transcript =
        typeof event.transcript === "string" && event.transcript.trim()
          ? event.transcript
          : this.assistantText;
      if (transcript.trim()) {
        this.callbacks.onAssistantTranscript(transcript.trim());
      }
      this.assistantText = "";
      return;
    }

    if (
      type === "conversation.item.input_audio_transcription.completed" ||
      /input_audio_transcription\.completed/.test(type)
    ) {
      const transcript = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (transcript) {
        this.callbacks.onUserTranscript(transcript);
      }
      return;
    }

    if (type === "error") {
      const message =
        typeof event.error === "object" &&
        event.error &&
        "message" in event.error &&
        typeof event.error.message === "string"
          ? event.error.message
          : "unknown Realtime error";
      this.callbacks.onError(message);
    }
  }
}
