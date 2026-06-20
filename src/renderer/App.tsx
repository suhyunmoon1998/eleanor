import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AiProvider,
  AppSettings,
  BootstrapState,
  ExtractionResult,
  SessionRecord,
} from "../shared/contracts.js";
import { getBridge, hasNativeBridge } from "./mock-bridge";
import { LiveRealtimeSession } from "./live-realtime";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: BootstrapState }
  | { status: "error"; message: string };

type ViewMode = "setup" | "map" | "settings";

type AudioDeviceOption = {
  deviceId: string;
  label: string;
};

const providerOptions: Array<{ value: AiProvider; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Claude" },
];
const voiceOptions = ["marin", "cedar", "alloy"];
const providerPresets: Record<AiProvider, Pick<AppSettings, "provider" | "realtimeModel" | "fallbackRealtimeModel" | "extractionModel" | "fallbackExtractionModel" | "voice">> = {
  openai: {
    provider: "openai",
    realtimeModel: "gpt-realtime",
    fallbackRealtimeModel: "gpt-realtime-mini",
    extractionModel: "gpt-5.2",
    fallbackExtractionModel: "gpt-5-mini",
    voice: "marin",
  },
  anthropic: {
    provider: "anthropic",
    realtimeModel: "gpt-realtime",
    fallbackRealtimeModel: "gpt-realtime-mini",
    extractionModel: "claude-sonnet-4-6",
    fallbackExtractionModel: "claude-haiku-4-5",
    voice: "marin",
  },
};

function providerSupportsLiveVoice(provider: AiProvider) {
  return provider === "openai";
}

function providerLabel(provider: AiProvider) {
  return provider === "anthropic" ? "Claude" : "OpenAI";
}

function applyProviderPreset(settings: AppSettings, provider: AiProvider): AppSettings {
  return {
    ...settings,
    ...providerPresets[provider],
    selectedInputDeviceId: settings.selectedInputDeviceId,
    selectedOutputDeviceId: settings.selectedOutputDeviceId,
  };
}

function buildExtractionPreview(session: SessionRecord | null): ExtractionResult | null {
  if (!session) return null;

  const hasSavedExtractionState = Boolean(
    session.lastAssistantReply ||
    session.currentQuestion ||
    session.lastPriorityReason ||
    session.missingCriticalFields.length > 0,
  );

  if (!hasSavedExtractionState) return null;

  return {
    spokenReply: session.lastAssistantReply || "No saved assistant reply yet.",
    nextQuestion: session.currentQuestion || "No saved next question yet.",
    priorityReason: session.lastPriorityReason || "No saved priority reason yet.",
    capturePatch: {},
    missingCriticalFields: session.missingCriticalFields,
    atomicTriggerIds: session.progress[session.familyId] ?? [],
    caseDevelopmentLeads: session.leads.filter((lead) => lead.kind === "case-development").map((lead) => lead.text),
    clientManagementLeads: session.leads.filter((lead) => lead.kind === "client-management").map((lead) => lead.text),
    clientDevelopmentLeads: session.leads.filter((lead) => lead.kind === "client-development").map((lead) => lead.text),
    contradictions: session.contradictions,
    parkedItems: session.leads.filter((lead) => lead.kind === "parked").map((lead) => lead.text),
  };
}

export function App() {
  const bridge = getBridge();
  const nativeBridge = hasNativeBridge();
  const liveSessionRef = useRef<LiveRealtimeSession | null>(null);
  const activeSessionRef = useRef<SessionRecord | null>(null);
  const bootstrapRef = useRef<BootstrapState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [viewMode, setViewMode] = useState<ViewMode>("setup");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [note, setNote] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [lastExtraction, setLastExtraction] = useState<ExtractionResult | null>(null);
  const [liveStatus, setLiveStatus] = useState("Live interview status will appear here.");
  const [liveConnected, setLiveConnected] = useState(false);
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [deviceSupport, setDeviceSupport] = useState("Device selection will appear when the browser or desktop runtime exposes media devices.");
  const provider = loadState.status === "ready" ? loadState.data.settings.provider : "anthropic";
  const liveRuntimeAvailable = providerSupportsLiveVoice(provider) && (nativeBridge || window.location.protocol.startsWith("http"));

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    if (loadState.status === "ready") {
      bootstrapRef.current = loadState.data;
    }
  }, [loadState]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    void loadDevices();
  }, [loadState]);

  useEffect(() => {
    if (liveConnected) return;
    if (provider === "anthropic") {
      setLiveStatus("Claude mode is connected for structured interviewing, but live browser voice is not available in this build.");
      return;
    }
    setLiveStatus("Live voice is available when Eleanor is running with a real OpenAI-backed server.");
  }, [provider, liveConnected]);

  useEffect(() => {
    return () => {
      liveSessionRef.current?.disconnect();
    };
  }, []);

  async function refresh() {
    try {
      const data = await bridge.bootstrap();
      setLoadState({ status: "ready", data });
      setViewMode(data.hasApiKey ? "map" : "setup");
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load Eleanor.",
      });
    }
  }

  async function loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(
        devices
          .filter((device) => device.kind === "audioinput")
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          })),
      );
      setOutputDevices(
        devices
          .filter((device) => device.kind === "audiooutput")
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Speaker ${index + 1}`,
          })),
      );
      setDeviceSupport("Audio device selection is available where the runtime exposes input and output devices.");
    } catch {
      setDeviceSupport("Audio devices are not currently available. This can happen before microphone permission is granted.");
    }
  }

  const sourceSummary = useMemo(() => {
    if (loadState.status !== "ready") return null;
    return loadState.data.sourceSummary;
  }, [loadState]);

  const settings = loadState.status === "ready" ? loadState.data.settings : null;

  async function handleTestConnection() {
    try {
      const result = await bridge.testConnection();
      setConnectionMessage(result.message);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Connection test failed.");
    }
  }

  async function handleSaveSettings(nextSettings: AppSettings) {
    try {
      await bridge.saveSettings(nextSettings);
      setSettingsMessage("Settings saved.");
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save settings.");
    }
  }

  async function handleProviderChange(nextProvider: AiProvider) {
    if (loadState.status !== "ready") return;
    const nextSettings = applyProviderPreset(loadState.data.settings, nextProvider);
    await handleSaveSettings(nextSettings);
  }

  async function handleExportData() {
    const result = await bridge.exportLocalData();
    setSettingsMessage(result.canceled ? "Export canceled." : `Local data exported to ${result.filePath}.`);
  }

  async function handleDeleteLocalData() {
    await bridge.deleteLocalData();
    setActiveSession(null);
    setLastExtraction(null);
    setConnectionMessage("");
    setSettingsMessage("Local data and saved credentials were deleted.");
    await refresh();
  }

  async function handleCreateSession(familyId: string, title: string) {
    const session = await bridge.createSession({ familyId, title });
    setActiveSession(session);
    setLastExtraction(buildExtractionPreview(session));
    await refresh();
  }

  async function appendTranscriptEntry(sessionId: string, role: "assistant" | "user", text: string) {
    const nextSession = await bridge.updateSession({
      sessionId,
      transcriptEntry: {
        id: crypto.randomUUID(),
        role,
        text,
        createdAt: new Date().toISOString(),
      },
    });
    setActiveSession(nextSession);
    return nextSession;
  }

  async function processVoiceTranscript(session: SessionRecord, transcriptText: string) {
    const updatedSession = await appendTranscriptEntry(session.id, "user", transcriptText);
    const result = await bridge.runExtraction({
      familyId: updatedSession.familyId,
      transcript: transcriptText,
      priorCapture: updatedSession.capture,
      parkedItems: updatedSession.leads.filter((lead) => lead.kind === "parked").map((lead) => lead.text),
    });

    setLastExtraction(result);
    const nextSession = await bridge.updateSession({
      sessionId: updatedSession.id,
      capturePatch: result.capturePatch,
      contradictions: result.contradictions,
      triggerIds: result.atomicTriggerIds,
      currentQuestion: result.nextQuestion,
      lastAssistantReply: result.spokenReply,
      lastPriorityReason: result.priorityReason,
      missingCriticalFields: result.missingCriticalFields,
      leads: [
        ...result.caseDevelopmentLeads.map((text) => ({ text, kind: "case-development" as const })),
        ...result.clientManagementLeads.map((text) => ({ text, kind: "client-management" as const })),
        ...result.clientDevelopmentLeads.map((text) => ({ text, kind: "client-development" as const })),
        ...result.parkedItems.map((text) => ({ text, kind: "parked" as const })),
      ],
    });
    setActiveSession(nextSession);
    setLastExtraction(buildExtractionPreview(nextSession));
    await refresh();
    if (liveSessionRef.current?.isConnected()) {
      sendStructuredLiveReply(nextSession, result);
    }
  }

  async function handleStartLiveVoice() {
    if (!providerSupportsLiveVoice(provider)) {
      setErrorMessage("Live browser voice is currently available only with the OpenAI provider. Claude mode still supports typed interviewing and structured extraction.");
      return;
    }
    if (!liveRuntimeAvailable) {
      setErrorMessage("Live voice requires either the desktop runtime or the web server mode with API routes.");
      return;
    }
    if (!activeSession) {
      setErrorMessage("Start a family session before connecting live voice.");
      return;
    }
    if (liveSessionRef.current?.isConnected()) {
      sendLiveFamilyPrompt(activeSession);
      return;
    }

    setErrorMessage("");
    const liveSession = new LiveRealtimeSession({
      onAssistantTranscript: (text) => {
        const currentSession = activeSessionRef.current;
        if (currentSession) {
          void appendTranscriptEntry(currentSession.id, "assistant", text);
        }
      },
      onUserTranscript: (text) => {
        const currentSession = activeSessionRef.current;
        if (currentSession) {
          void processVoiceTranscript(currentSession, text);
        }
      },
      onStatus: (text) => setLiveStatus(text),
      onConnectionChange: (connected) => setLiveConnected(connected),
      onError: (message) => setErrorMessage(message),
    });
    liveSessionRef.current = liveSession;

    try {
      await liveSession.connect({
        createRealtimeSession: (offerSdp) => bridge.createRealtimeSession(offerSdp),
        inputDeviceId: data.settings.selectedInputDeviceId,
      });
      sendLiveFamilyPrompt(activeSession, true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to start live voice.");
    }
  }

  function handleStopLiveVoice() {
    liveSessionRef.current?.disconnect();
    liveSessionRef.current = null;
    setLiveConnected(false);
  }

  function sendLiveFamilyPrompt(session: SessionRecord, isOpening = false) {
    const bootstrap = bootstrapRef.current;
    const family = bootstrap?.families.find((item) => item.familyId === session.familyId);
    if (!family || !liveSessionRef.current?.isConnected()) return;
    const prompt = [
      isOpening || session.transcript.length === 0
        ? "Begin R1A now with one concise opening question."
        : session.currentQuestion
          ? "Resume the live interview using the saved pending question unless the user has already answered it."
          : "Continue the live interview from the current family. Ask one concise next question.",
      `Current family: ${family.familyId} — ${family.title}`,
      `Interview goal: ${family.interviewGoal}`,
      family.expectedTriggerNames.length > 0
        ? `Expected triggers: ${family.expectedTriggerNames.join("; ")}`
        : "",
      session.lastAssistantReply ? `Last approved reply: ${session.lastAssistantReply}` : "",
      session.currentQuestion ? `Saved pending question: ${session.currentQuestion}` : "",
      session.lastPriorityReason ? `Priority reason: ${session.lastPriorityReason}` : "",
      session.missingCriticalFields.length > 0
        ? `Still-missing critical fields: ${session.missingCriticalFields.join("; ")}` : "",
      "Do not read this brief aloud.",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      liveSessionRef.current.requestAssistantReply(prompt);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not send the live prompt.");
    }
  }

  function sendStructuredLiveReply(session: SessionRecord, result: ExtractionResult) {
    if (!liveSessionRef.current?.isConnected()) return;

    const family = bootstrapRef.current?.families.find((item) => item.familyId === session.familyId);
    const prompt = [
      "Speak exactly the approved reply below in Eleanor's voice.",
      "After that, ask exactly the approved next question below.",
      "Do not add preamble, explanation, or extra commentary.",
      family ? `Current family: ${family.familyId} — ${family.title}` : "",
      `Approved reply: ${result.spokenReply}`,
      `Approved next question: ${result.nextQuestion}`,
      `Priority reason: ${result.priorityReason}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      liveSessionRef.current.requestAssistantReply(prompt);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not send the structured follow-up.");
    }
  }

  async function handleRunExtraction() {
    if (!activeSession || !note.trim()) return;
    setIsExtracting(true);
    try {
      const transcriptEntry = {
        id: crypto.randomUUID(),
        role: "user" as const,
        text: note.trim(),
        createdAt: new Date().toISOString(),
      };
      const updatedSession = await bridge.updateSession({
        sessionId: activeSession.id,
        transcriptEntry,
      });
      setActiveSession(updatedSession);
      setNote("");

      const result = await bridge.runExtraction({
        familyId: updatedSession.familyId,
        transcript: transcriptEntry.text,
        priorCapture: updatedSession.capture,
        parkedItems: updatedSession.leads.filter((lead) => lead.kind === "parked").map((lead) => lead.text),
      });

      setLastExtraction(result);

      const assistantEntry = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        text: result.spokenReply,
        createdAt: new Date().toISOString(),
      };

      const nextSession = await bridge.updateSession({
        sessionId: updatedSession.id,
        transcriptEntry: assistantEntry,
        capturePatch: result.capturePatch,
        contradictions: result.contradictions,
        triggerIds: result.atomicTriggerIds,
        currentQuestion: result.nextQuestion,
        lastAssistantReply: result.spokenReply,
        lastPriorityReason: result.priorityReason,
        missingCriticalFields: result.missingCriticalFields,
        leads: [
          ...result.caseDevelopmentLeads.map((text) => ({ text, kind: "case-development" as const })),
          ...result.clientManagementLeads.map((text) => ({ text, kind: "client-management" as const })),
          ...result.clientDevelopmentLeads.map((text) => ({ text, kind: "client-development" as const })),
          ...result.parkedItems.map((text) => ({ text, kind: "parked" as const })),
        ],
      });
      setActiveSession(nextSession);
      await refresh();
      if (liveConnected && liveSessionRef.current?.isConnected()) {
        sendStructuredLiveReply(nextSession, result);
      }
    } finally {
      setIsExtracting(false);
    }
  }

  if (loadState.status === "loading") {
    return <div className="shell loading">Loading Eleanor v3…</div>;
  }

  if (loadState.status === "error") {
    return <div className="shell loading">{loadState.message}</div>;
  }

  const { data } = loadState;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Jack Law</p>
          <h1>Eleanor v3</h1>
          <p className="subtle">Fast interview capture for Jack.</p>
        </div>

        <nav className="nav card">
          <button className={`nav-button ${viewMode === "map" ? "nav-button-active" : ""}`} onClick={() => setViewMode(data.hasApiKey ? "map" : "setup")}>
            Interview
          </button>
          <button className={`nav-button ${viewMode === "settings" ? "nav-button-active" : ""}`} onClick={() => setViewMode("settings")}>
            Settings
          </button>
        </nav>

        <section className="card">
          <p className="section-title">Library</p>
          <div className="stats">
            <div>
              <strong>{sourceSummary?.familyCount}</strong>
              <span>Families</span>
            </div>
            <div>
              <strong>{sourceSummary?.sectionCount}</strong>
              <span>Sections</span>
            </div>
            <div>
              <strong>{sourceSummary?.nomenclatureCount}</strong>
              <span>Terms</span>
            </div>
          </div>
        </section>

        <section className="card">
          <p className="section-title">Ready</p>
          <div className="stack">
            <p className="hint">
              {data.hasApiKey
                ? `${providerLabel(data.settings.provider)} connected`
                : "Render API key needed"}
            </p>
            {connectionMessage ? <p className="hint success">{connectionMessage}</p> : null}
            {settingsMessage ? <p className="hint success">{settingsMessage}</p> : null}
            {errorMessage ? <p className="hint danger">{errorMessage}</p> : null}
          </div>
        </section>

        <section className="card">
          <p className="section-title">Recent Sessions</p>
          <div className="stack">
            {data.recentSessions.length === 0 ? <p className="hint">No sessions yet.</p> : null}
            {data.recentSessions.map((session) => (
              <button
                key={session.id}
                className="list-button"
                onClick={() => {
                  setActiveSession(session);
                  setLastExtraction(buildExtractionPreview(session));
                  setViewMode("map");
                }}
              >
                <strong>{session.title}</strong>
                <span>{session.familyId}</span>
                <span>{(session.progress[session.familyId] ?? []).length} confirmed</span>
                {session.currentQuestion ? <span className="list-note">{session.currentQuestion}</span> : null}
              </button>
            ))}
          </div>
        </section>
      </aside>

      <main className="content">
        {viewMode === "setup" ? (
          <section className="setup-screen">
            <div className="hero setup-hero">
              <p className="eyebrow">Start</p>
              <h2>Server key needed.</h2>
              <p>Add `ELEANOR_API_KEY` in Render, then redeploy.</p>
            </div>

            <article className="card tall compact-card">
              <div className="segmented">
                {providerOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`segmented-button ${data.settings.provider === option.value ? "segmented-button-active" : ""}`}
                    onClick={() => void handleProviderChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="hint">
                Waiting for Render environment variable: ELEANOR_API_KEY
              </p>
              <button className="button" onClick={() => void refresh()}>
                Check Again
              </button>
              <p className="hint">
                Model: {settings?.extractionModel}{data.settings.provider === "openai" ? ` + ${settings?.realtimeModel}` : ""}
              </p>
            </article>
          </section>
        ) : null}

        {viewMode === "settings" ? (
          <SettingsView
            settings={data.settings}
            inputDevices={inputDevices}
            outputDevices={outputDevices}
            deviceSupport={deviceSupport}
            onSave={handleSaveSettings}
            onTestConnection={handleTestConnection}
            onExportData={handleExportData}
            onDeleteLocalData={handleDeleteLocalData}
            hasApiKey={data.hasApiKey}
          />
        ) : null}

        {viewMode === "map" ? (
          <InterviewView
            data={data}
            activeSession={activeSession}
            note={note}
            isExtracting={isExtracting}
            lastExtraction={lastExtraction}
            liveStatus={liveStatus}
            liveConnected={liveConnected}
            liveAvailable={liveRuntimeAvailable}
            provider={data.settings.provider}
            onBackToMap={() => {
              setActiveSession(null);
              setLastExtraction(null);
            }}
            onCreateSession={handleCreateSession}
            onChangeNote={setNote}
            onRunExtraction={handleRunExtraction}
            onStartLiveVoice={handleStartLiveVoice}
            onStopLiveVoice={handleStopLiveVoice}
          />
        ) : null}
      </main>
    </div>
  );
}

function SettingsView(props: {
  settings: AppSettings;
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  deviceSupport: string;
  hasApiKey: boolean;
  onSave: (settings: AppSettings) => Promise<void>;
  onTestConnection: () => Promise<void>;
  onExportData: () => Promise<void>;
  onDeleteLocalData: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<AppSettings>(props.settings);

  useEffect(() => {
    setDraft(props.settings);
  }, [props.settings]);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="settings-layout">
      <section className="hero">
        <p className="eyebrow">Settings</p>
        <h2>Keep it simple.</h2>
        <p>Only change these if you need to.</p>
      </section>

      <section className="settings-grid">
        <article className="card tall">
          <p className="section-title">AI Setup</p>
          <label className="field">
            <span>Provider</span>
            <select className="input" value={draft.provider} onChange={(event) => update("provider", event.target.value as AiProvider)}>
              {providerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Main model</span>
            <input className="input" value={draft.extractionModel} onChange={(event) => update("extractionModel", event.target.value)} />
          </label>
          <label className="field">
            <span>Backup model</span>
            <input className="input" value={draft.fallbackExtractionModel} onChange={(event) => update("fallbackExtractionModel", event.target.value)} />
          </label>
          {draft.provider === "openai" ? (
            <>
              <label className="field">
                <span>Live model</span>
                <input className="input" value={draft.realtimeModel} onChange={(event) => update("realtimeModel", event.target.value)} />
              </label>
              <label className="field">
                <span>Live backup</span>
                <input className="input" value={draft.fallbackRealtimeModel} onChange={(event) => update("fallbackRealtimeModel", event.target.value)} />
              </label>
              <label className="field">
                <span>Voice</span>
                <select className="input" value={draft.voice} onChange={(event) => update("voice", event.target.value)}>
                  {voiceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
            </>
          ) : (
            <p className="hint">Claude mode uses typed interview only.</p>
          )}
          <button className="button" onClick={() => void props.onSave(draft)}>Save</button>
        </article>

        <article className="card tall">
          <p className="section-title">Audio</p>
          <label className="field">
            <span>Mic</span>
            <select className="input" value={draft.selectedInputDeviceId ?? ""} onChange={(event) => update("selectedInputDeviceId", event.target.value || undefined)}>
              <option value="">System default</option>
              {props.inputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Speaker</span>
            <select className="input" value={draft.selectedOutputDeviceId ?? ""} onChange={(event) => update("selectedOutputDeviceId", event.target.value || undefined)}>
              <option value="">System default</option>
              {props.outputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            </select>
          </label>
          <p className="hint">{props.deviceSupport}</p>
        </article>

        <article className="card tall">
          <p className="section-title">Tools</p>
          <button className="button button-secondary" onClick={() => void props.onTestConnection()} disabled={!props.hasApiKey}>
            Test
          </button>
          <button className="button button-secondary" onClick={() => void props.onExportData()}>
            Export
          </button>
          <button className="button button-danger" onClick={() => void props.onDeleteLocalData()}>
            Reset
          </button>
        </article>
      </section>
    </section>
  );
}

function InterviewView(props: {
  data: BootstrapState;
  activeSession: SessionRecord | null;
  note: string;
  isExtracting: boolean;
  lastExtraction: ExtractionResult | null;
  liveStatus: string;
  liveConnected: boolean;
  liveAvailable: boolean;
  provider: AiProvider;
  onBackToMap: () => void;
  onCreateSession: (familyId: string, title: string) => Promise<void>;
  onChangeNote: (value: string) => void;
  onRunExtraction: () => Promise<void>;
  onStartLiveVoice: () => Promise<void>;
  onStopLiveVoice: () => void;
}) {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Interview</p>
          <h2>Pick a family and start.</h2>
          <p>Say what happened. Eleanor finds the next question.</p>
        </div>
      </section>

      {!props.activeSession ? (
        <section className="family-grid">
          {props.data.families.map((family) => (
            <article key={family.familyId} className="family-card">
              <div className="family-meta">
                <span>{family.familyId}</span>
                <span>{family.triggerCount} triggers</span>
              </div>
              <h3>{family.title}</h3>
              <p>{family.interviewGoal}</p>
              <button className="button" onClick={() => void props.onCreateSession(family.familyId, `${family.familyId} — ${family.title}`)}>
                Start
              </button>
            </article>
          ))}
        </section>
      ) : (
        <section className="workspace">
          <div className="workspace-header">
            <div>
              <p className="eyebrow">{props.activeSession.familyId}</p>
              <h2>{props.activeSession.title}</h2>
            </div>
            <button className="button button-secondary" onClick={props.onBackToMap}>Back</button>
          </div>

          <div className="workspace-grid">
            <section className="card tall">
              <p className="section-title">Talk</p>
              <div className={`live-box ${props.liveConnected ? "live-box-on" : ""}`}>
                <div>
                  <strong>{props.provider === "openai" ? "Live" : "Typed Only"}</strong>
                  <p>{props.liveStatus}</p>
                </div>
                <div className="live-actions">
                  <button className="button" onClick={() => void props.onStartLiveVoice()} disabled={!props.liveAvailable}>
                    {props.provider === "openai" ? (props.liveConnected ? "Ask Next" : "Start Voice") : "Voice Off"}
                  </button>
                  <button className="button button-secondary" onClick={props.onStopLiveVoice} disabled={!props.liveConnected}>
                    Stop
                  </button>
                </div>
              </div>
              <div className="transcript">
                {props.activeSession.transcript.length === 0 ? <p className="hint">No turns yet.</p> : null}
                {props.activeSession.transcript.map((entry) => (
                  <div key={entry.id} className={`bubble bubble-${entry.role}`}>
                    <span>{entry.role}</span>
                    <p>{entry.text}</p>
                  </div>
                ))}
              </div>
              <textarea
                className="textarea"
                value={props.note}
                onChange={(event) => props.onChangeNote(event.target.value)}
                placeholder="Type or paste Jack's latest answer."
              />
              <button className="button" onClick={() => void props.onRunExtraction()} disabled={props.isExtracting || !props.note.trim() || !props.data.hasApiKey}>
                {props.isExtracting ? "Working…" : "Next Question"}
              </button>
            </section>

            <section className="card tall">
              <p className="section-title">Next Step</p>
              {!props.lastExtraction ? <p className="hint">Nothing yet.</p> : null}
              {props.lastExtraction ? (
                <div className="stack">
                  <div>
                    <strong>Reply</strong>
                    <p>{props.lastExtraction.spokenReply}</p>
                  </div>
                  <div>
                    <strong>Ask</strong>
                    <p>{props.lastExtraction.nextQuestion}</p>
                  </div>
                  <div>
                    <strong>Missing</strong>
                    <p>{props.lastExtraction.missingCriticalFields.join(", ") || "None listed"}</p>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="card tall">
              <p className="section-title">Progress</p>
              <div className="stack">
                <div>
                  <strong>Confirmed</strong>
                  <p>{(props.activeSession.progress[props.activeSession.familyId] ?? []).join(", ") || "None yet"}</p>
                </div>
                <div>
                  <strong>Pending</strong>
                  <p>{props.activeSession.currentQuestion || "No saved next question yet"}</p>
                </div>
                <div>
                  <strong>Missing</strong>
                  <p>{props.activeSession.missingCriticalFields.join(", ") || "None currently tracked"}</p>
                </div>
              </div>
            </section>
          </div>
        </section>
      )}
    </>
  );
}
