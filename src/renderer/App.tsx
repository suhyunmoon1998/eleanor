import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AiProvider,
  AppSettings,
  BootstrapState,
  ExtractionResult,
  FinalReportResult,
  SessionRecord,
} from "../shared/contracts.js";
import { buildAssistantTurnText } from "../shared/assistant-turn.js";
import { getBridge, hasNativeBridge } from "./mock-bridge";
import { LiveRealtimeSession } from "./live-realtime";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: BootstrapState }
  | { status: "error"; message: string };

type ViewMode = "setup" | "map";

type AudioDeviceOption = {
  deviceId: string;
  label: string;
};

type CompletedReport = {
  session: SessionRecord;
  endedAt: string;
  summary: string;
  title: string;
  problemAnswerPairs: FinalReportResult["problemAnswerPairs"];
  keyPoints: string[];
  openQuestions: string[];
  unsavedDraft?: string;
  aiGenerated: boolean;
};

const providerOptions: Array<{ value: AiProvider; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Claude" },
];
const voiceOptions = ["coral", "shimmer", "sage", "marin", "cedar", "alloy"];
const LIVE_IDLE_FAILSAFE_MS = 5 * 60 * 1000;
const LIVE_MAX_SESSION_MS = 45 * 60 * 1000;
const providerPresets: Record<AiProvider, Pick<AppSettings, "provider" | "realtimeModel" | "fallbackRealtimeModel" | "extractionModel" | "fallbackExtractionModel" | "voice">> = {
  openai: {
    provider: "openai",
    realtimeModel: "gpt-realtime",
    fallbackRealtimeModel: "gpt-realtime-mini",
    extractionModel: "gpt-5.2",
    fallbackExtractionModel: "gpt-5-mini",
    voice: "coral",
  },
  anthropic: {
    provider: "anthropic",
    realtimeModel: "gpt-realtime",
    fallbackRealtimeModel: "gpt-realtime-mini",
    extractionModel: "claude-sonnet-4-6",
    fallbackExtractionModel: "claude-haiku-4-5",
    voice: "coral",
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function shortText(text: string, maxLength = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function buildFallbackProblemAnswerPairs(session: SessionRecord, unsavedDraft: string): FinalReportResult["problemAnswerPairs"] {
  const pairs: FinalReportResult["problemAnswerPairs"] = [];
  const captureEntries = Object.entries(session.capture).slice(-8);

  captureEntries.forEach(([key, value]) => {
    const patch =
      value && typeof value === "object"
        ? (value as { entity?: unknown; field?: unknown; value?: unknown; status?: unknown })
        : null;
    const problem = [patch?.entity, patch?.field].filter(Boolean).join(" / ") || key;
    const answer = typeof patch?.value === "string" ? patch.value : shortText(JSON.stringify(value), 240);

    pairs.push({
      problem: `What is confirmed for ${problem}?`,
      answer: answer || "Not confirmed.",
      evidence: typeof patch?.status === "string" ? patch.status : "Saved structured capture.",
    });
  });

  if (pairs.length === 0 && session.progress[session.familyId]?.length) {
    pairs.push({
      problem: `Which ${session.familyId} triggers were confirmed?`,
      answer: session.progress[session.familyId].join(", "),
      evidence: "Saved trigger progress.",
    });
  }

  if (unsavedDraft.trim()) {
    pairs.push({
      problem: "What still needs review from the final typed note?",
      answer: shortText(unsavedDraft, 240),
      evidence: "Typed draft at finish time.",
    });
  }

  return pairs.length > 0
    ? pairs
    : [{ problem: "What operational issue was resolved?", answer: "No structured answer has been captured yet.", evidence: null }];
}

function buildCompletedReport(
  session: SessionRecord,
  lastExtraction: ExtractionResult | null,
  unsavedDraft: string,
  aiReport?: FinalReportResult | null,
): CompletedReport {
  const userTurns = session.transcript.filter((entry) => entry.role === "user");
  const assistantTurns = session.transcript.filter((entry) => entry.role === "assistant");
  const latestUserTurns = userTurns.slice(-5).map((entry) => shortText(entry.text));
  const openQuestions = [
    session.currentQuestion,
    ...(lastExtraction?.missingCriticalFields ?? session.missingCriticalFields),
  ].filter((item): item is string => Boolean(item?.trim()));

  const summaryParts = [
    userTurns.length > 0
      ? `Captured ${userTurns.length} user answer${userTurns.length === 1 ? "" : "s"} and ${assistantTurns.length} Eleanor turn${assistantTurns.length === 1 ? "" : "s"} for ${session.familyId}.`
      : `Started ${session.familyId}, but no user answers were finalized yet.`,
    latestUserTurns.length > 0 ? `Most recent substance: ${latestUserTurns.join(" / ")}` : "",
    openQuestions.length > 0 ? `Still needs follow-up on: ${openQuestions.slice(0, 3).join("; ")}.` : "No open follow-up was saved.",
  ].filter(Boolean);

  return {
    session,
    endedAt: new Date().toISOString(),
    title: aiReport?.title ?? `${session.title} final report`,
    summary: aiReport?.summary ?? summaryParts.join(" "),
    problemAnswerPairs: aiReport?.problemAnswerPairs?.length
      ? aiReport.problemAnswerPairs
      : buildFallbackProblemAnswerPairs(session, unsavedDraft),
    keyPoints: aiReport?.keyPoints?.length ? aiReport.keyPoints : latestUserTurns.length > 0 ? latestUserTurns : ["No finalized user answers yet."],
    openQuestions: aiReport?.openQuestions?.length ? aiReport.openQuestions : openQuestions.length > 0 ? openQuestions : ["No saved open question."],
    unsavedDraft: unsavedDraft.trim() || undefined,
    aiGenerated: Boolean(aiReport),
  };
}

function formatProblemAnswerReport(report: CompletedReport | null) {
  if (!report) return "";
  return [
    report.title,
    "",
    report.summary,
    "",
    ...report.problemAnswerPairs.flatMap((pair, index) => [
      `${index + 1}. Problem: ${pair.problem}`,
      `   Answer: ${pair.answer}`,
      pair.evidence ? `   Evidence: ${pair.evidence}` : "",
      "",
    ]),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatConversationTranscript(session: SessionRecord | null) {
  if (!session) return "";
  const transcript = session.transcript.length
    ? session.transcript.flatMap((entry, index) => [
        `${index + 1}. ${entry.role.toUpperCase()} · ${formatDateTime(entry.createdAt)}`,
        entry.text.trim() || "(empty)",
        "",
      ])
    : ["No saved conversation turns yet."];

  return [
    `Conversation History: ${session.title}`,
    `Session ID: ${session.id}`,
    `Family: ${session.familyId}`,
    `Created: ${formatDateTime(session.createdAt)}`,
    `Updated: ${formatDateTime(session.updatedAt)}`,
    "",
    ...transcript,
  ].join("\n").trim();
}

export function App() {
  const bridge = getBridge();
  const nativeBridge = hasNativeBridge();
  const liveSessionRef = useRef<LiveRealtimeSession | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveIdleTimerRef = useRef<number | null>(null);
  const liveMaxTimerRef = useRef<number | null>(null);
  const isExtractingRef = useRef(false);
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
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [lastExtraction, setLastExtraction] = useState<ExtractionResult | null>(null);
  const [completedReport, setCompletedReport] = useState<CompletedReport | null>(null);
  const [liveStatus, setLiveStatus] = useState("Live interview status will appear here.");
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveTranscriptPreview, setLiveTranscriptPreview] = useState("");
  const [micPaused, setMicPaused] = useState(false);
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
    isExtractingRef.current = isExtracting;
  }, [isExtracting]);

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
      setLiveStatus("Voice is available with OpenAI mode.");
      return;
    }
    setLiveStatus("Ready for voice.");
  }, [provider, liveConnected]);

  useEffect(() => {
    return () => {
      clearLiveFailsafeTimers();
      stopTtsAudio();
      liveSessionRef.current?.disconnect();
    };
  }, []);

  function stopTtsAudio() {
    if (!ttsAudioRef.current) return;
    ttsAudioRef.current.pause();
    ttsAudioRef.current.src = "";
    ttsAudioRef.current = null;
  }

  function clearLiveFailsafeTimers() {
    if (liveIdleTimerRef.current) {
      window.clearTimeout(liveIdleTimerRef.current);
      liveIdleTimerRef.current = null;
    }
    if (liveMaxTimerRef.current) {
      window.clearTimeout(liveMaxTimerRef.current);
      liveMaxTimerRef.current = null;
    }
  }

  function resetLiveIdleFailsafe() {
    if (!liveSessionRef.current?.isConnected()) return;
    if (liveIdleTimerRef.current) {
      window.clearTimeout(liveIdleTimerRef.current);
    }
    liveIdleTimerRef.current = window.setTimeout(() => {
      stopLiveVoice("Live voice stopped automatically after 5 minutes without user speech.");
    }, LIVE_IDLE_FAILSAFE_MS);
  }

  function armLiveFailsafes() {
    clearLiveFailsafeTimers();
    resetLiveIdleFailsafe();
    liveMaxTimerRef.current = window.setTimeout(() => {
      stopLiveVoice("Live voice stopped automatically after 45 minutes for safety.");
    }, LIVE_MAX_SESSION_MS);
  }

  function noteUserSpeechActivity() {
    resetLiveIdleFailsafe();
  }

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
    setSettingsMessage(result.canceled ? "Export canceled." : `Raw JSON backup exported to ${result.filePath}.`);
  }

  async function handleExportKnowledgePack() {
    const result = await bridge.exportKnowledgePack();
    setSettingsMessage(result.canceled ? "Export canceled." : `ChatGPT knowledge pack exported to ${result.filePath}.`);
  }

  async function handleDeleteLocalData() {
    await bridge.deleteLocalData();
    setActiveSession(null);
    setLastExtraction(null);
    setConnectionMessage("");
    setSettingsMessage("Local data and saved credentials were deleted.");
    await refresh();
  }

  async function handleCreateSession(familyId: string, title: string, startVoice = false) {
    const session = await bridge.createSession({ familyId, title });
    setCompletedReport(null);
    setActiveSession(session);
    activeSessionRef.current = session;
    setLastExtraction(buildExtractionPreview(session));
    setNote("");
    setLiveTranscriptPreview("");
    await refresh();
    if (startVoice) {
      await handleStartLiveVoice(session);
    }
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

  function appendDraftAnswer(transcriptText: string) {
    const cleanText = transcriptText.trim();
    if (!cleanText) return;
    setNote((current) => {
      const trimmed = current.trim();
      if (!trimmed) return cleanText;
      if (trimmed.includes(cleanText)) return current;
      return `${trimmed}\n\n${cleanText}`;
    });
    setLiveTranscriptPreview("");
    setLiveStatus("Got it. Eleanor is preparing a response.");
  }

  async function processFinalAnswer(session: SessionRecord, answerText: string) {
    const cleanAnswer = answerText.trim();
    if (!cleanAnswer || isExtractingRef.current) return;

    isExtractingRef.current = true;
    setIsExtracting(true);
    liveSessionRef.current?.setMicrophoneEnabled(false);
    setMicPaused(true);
    setLiveStatus("Thinking...");

    try {
      const transcriptEntry = {
        id: crypto.randomUUID(),
        role: "user" as const,
        text: cleanAnswer,
        createdAt: new Date().toISOString(),
      };
      const lastTurn = session.transcript.at(-1);
      const updatedSession =
        lastTurn?.role === "user" && lastTurn.text.trim() === cleanAnswer
          ? session
          : await bridge.updateSession({
              sessionId: session.id,
              transcriptEntry,
            });
      setActiveSession(updatedSession);
      activeSessionRef.current = updatedSession;

      const result = await withTimeout(
        bridge.runExtraction({
          familyId: updatedSession.familyId,
          currentQuestion: updatedSession.currentQuestion,
          transcript: transcriptEntry.text,
          priorCapture: updatedSession.capture,
          parkedItems: updatedSession.leads.filter((lead) => lead.kind === "parked").map((lead) => lead.text),
        }),
        45_000,
        "Eleanor took too long to analyze that answer.",
      );

      setLastExtraction(result);

      const assistantEntry = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        text: buildAssistantTurnText(result.spokenReply, result.nextQuestion),
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
      activeSessionRef.current = nextSession;
      setNote("");
      await refresh();

      if (liveSessionRef.current?.isConnected()) {
        const replyText = buildAssistantTurnText(result.spokenReply, result.nextQuestion);
        const usedBritishTts = await playAssistantSpeech(replyText);
        if (!usedBritishTts) {
          sendStructuredLiveReply(nextSession, result);
        }
        liveSessionRef.current.setMicrophoneEnabled(true);
        setMicPaused(false);
        setLiveStatus("Listening...");
      } else {
        setLiveStatus("Next question is ready.");
      }
    } catch (error) {
      setNote(cleanAnswer);
      setErrorMessage(error instanceof Error ? error.message : "Eleanor could not analyze that answer.");
      if (liveSessionRef.current?.isConnected()) {
        liveSessionRef.current.setMicrophoneEnabled(true);
        setMicPaused(false);
        setLiveStatus("I had trouble thinking through that. You can keep talking or press Send now to retry.");
      } else {
        setLiveStatus("Analysis failed. You can press Send now to retry.");
      }
    } finally {
      isExtractingRef.current = false;
      setIsExtracting(false);
    }
  }

  async function handleStartLiveVoice(sessionOverride?: SessionRecord) {
    const session = sessionOverride ?? activeSession;
    if (!providerSupportsLiveVoice(provider)) {
      setErrorMessage("Voice mode needs OpenAI.");
      return;
    }
    if (!liveRuntimeAvailable) {
      setErrorMessage("Voice mode needs the web app URL.");
      return;
    }
    if (!session) {
      setErrorMessage("Start a family session before connecting live voice.");
      return;
    }
    if (liveSessionRef.current?.isConnected()) {
      void speakLivePromptOrFallback(session);
      return;
    }

    setErrorMessage("");
    setLiveStatus("Connecting microphone...");
    const liveSession = new LiveRealtimeSession({
      onAssistantTranscript: (text) => {
        const currentSession = activeSessionRef.current;
        if (currentSession) {
          void appendTranscriptEntry(currentSession.id, "assistant", text);
        }
      },
      onUserTranscriptDelta: (text) => {
        noteUserSpeechActivity();
        setLiveTranscriptPreview(text);
        setLiveStatus("Listening...");
      },
      onUserTranscript: (text) => {
        noteUserSpeechActivity();
        appendDraftAnswer(text);
        const currentSession = activeSessionRef.current;
        if (currentSession) {
          void processFinalAnswer(currentSession, text);
        }
      },
      onSpeechStart: () => {
        noteUserSpeechActivity();
        setLiveStatus("I can hear you...");
      },
      onSpeechStop: () => {
        noteUserSpeechActivity();
        setLiveStatus("Transcribing...");
      },
      onStatus: (text) => {
        setLiveStatus(text);
      },
      onConnectionChange: (connected) => {
        setLiveConnected(connected);
        if (connected) {
          resetLiveIdleFailsafe();
        } else {
          clearLiveFailsafeTimers();
        }
      },
      onError: (message) => {
        setErrorMessage(message);
        stopLiveVoice("Live voice stopped automatically after a connection error.");
      },
    });
    liveSessionRef.current = liveSession;
    activeSessionRef.current = session;

    try {
      await liveSession.connect({
        createRealtimeSession: (offerSdp) => bridge.createRealtimeSession(offerSdp),
        inputDeviceId: data.settings.selectedInputDeviceId,
      });
      setMicPaused(false);
      armLiveFailsafes();
      void speakLivePromptOrFallback(session, true);
    } catch (error) {
      clearLiveFailsafeTimers();
      liveSessionRef.current = null;
      setLiveConnected(false);
      setMicPaused(false);
      setErrorMessage(error instanceof Error ? error.message : "Failed to start voice.");
    }
  }

  function stopLiveVoice(statusMessage?: string) {
    clearLiveFailsafeTimers();
    stopTtsAudio();
    liveSessionRef.current?.disconnect();
    liveSessionRef.current = null;
    setLiveConnected(false);
    setLiveTranscriptPreview("");
    setMicPaused(false);
    if (statusMessage) {
      setLiveStatus(statusMessage);
    }
  }

  function handleStopLiveVoice() {
    stopLiveVoice();
  }

  async function handleFinishInterview() {
    const session = activeSessionRef.current ?? activeSession;
    if (!session) return;
    handleStopLiveVoice();
    setIsFinalizing(true);
    setLiveStatus("Creating final problem-answer summary...");
    let aiReport: FinalReportResult | null = null;
    try {
      aiReport = await withTimeout(
        bridge.finalizeReport({
          session,
          lastExtraction,
          unsavedDraft: note,
        }),
        60_000,
        "Eleanor took too long to create the final problem-answer report.",
      );
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create the AI final report. Showing a local summary instead.");
    }
    setCompletedReport(buildCompletedReport(session, lastExtraction, note, aiReport));
    setActiveSession(null);
    setLastExtraction(null);
    setLiveTranscriptPreview("");
    setNote("");
    setViewMode("map");
    setIsFinalizing(false);
  }

  function handleStartOver() {
    setCompletedReport(null);
    setActiveSession(null);
    setLastExtraction(null);
    setLiveTranscriptPreview("");
    setNote("");
    setViewMode(loadState.status === "ready" && loadState.data.hasApiKey ? "map" : "setup");
  }

  function handlePauseCapture() {
    liveSessionRef.current?.setMicrophoneEnabled(false);
    setMicPaused(true);
  }

  function handleResumeCapture() {
    liveSessionRef.current?.setMicrophoneEnabled(true);
    setMicPaused(false);
  }

  function handleToggleMute() {
    if (!liveSessionRef.current?.isConnected()) return;
    const shouldEnable = !micPaused;
    liveSessionRef.current.setMicrophoneEnabled(!shouldEnable);
    setMicPaused(shouldEnable);
  }

  function sendLiveFamilyPrompt(session: SessionRecord, isOpening = false) {
    const bootstrap = bootstrapRef.current;
    const family = bootstrap?.families.find((item) => item.familyId === session.familyId);
    if (!family || !liveSessionRef.current?.isConnected()) return;
    const prompt = [
      isOpening || session.transcript.length === 0
        ? "Begin the live conversation now with one concise, thoughtful opening question."
        : session.currentQuestion
          ? "Resume naturally. If the user has not answered the saved pending question, ask it conversationally. If they have, ask the best follow-up."
          : "Continue the live conversation from the current family. Answer any user question first, then ask one thoughtful follow-up.",
      `Current family: ${family.familyId} — ${family.title}`,
      `Interview goal: ${family.interviewGoal}`,
      family.expectedTriggerNames.length > 0
        ? `Expected triggers: ${family.expectedTriggerNames.join("; ")}`
        : "",
      "Speech understanding rule: Jack may mispronounce terms or mix Korean and English. Use the family title, expected triggers, prior answers, and legal/process context to infer the intended term when clear. If uncertain, ask a short confirmation question before saving it.",
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

  async function speakLivePromptOrFallback(session: SessionRecord, isOpening = false) {
    const promptText = buildLivePromptText(session, isOpening);
    const usedBritishTts = await playAssistantSpeech(promptText);
    if (!usedBritishTts) {
      sendLiveFamilyPrompt(session, isOpening);
    }
  }

  function buildLivePromptText(session: SessionRecord, isOpening = false) {
    if (!isOpening && session.currentQuestion.trim()) {
      return session.currentQuestion.trim();
    }

    if (session.lastAssistantReply.trim() || session.currentQuestion.trim()) {
      return [session.lastAssistantReply, session.currentQuestion].filter(Boolean).join("\n\n");
    }

    return "Good afternoon. Could you tell me what happens first in this part of the workflow?";
  }

  async function playAssistantSpeech(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return false;
    const shouldRestoreMic = liveSessionRef.current?.isConnected() && liveSessionRef.current.isMicrophoneEnabled();

    try {
      const audioBlob = await bridge.synthesizeSpeech({ text: cleanText });
      if (!audioBlob) return false;

      stopTtsAudio();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      ttsAudioRef.current = audio;
      if (shouldRestoreMic) {
        liveSessionRef.current?.setMicrophoneEnabled(false);
        setMicPaused(true);
      }
      setLiveStatus("Eleanor is speaking with British TTS...");

      try {
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("British TTS playback failed."));
          void audio.play().catch(reject);
        });
      } finally {
        if (ttsAudioRef.current === audio) {
          ttsAudioRef.current = null;
        }
        URL.revokeObjectURL(audioUrl);
        if (shouldRestoreMic && liveSessionRef.current?.isConnected()) {
          liveSessionRef.current.setMicrophoneEnabled(true);
          setMicPaused(false);
        }
      }

      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "British TTS failed. Falling back to OpenAI voice.");
      if (shouldRestoreMic && liveSessionRef.current?.isConnected()) {
        liveSessionRef.current.setMicrophoneEnabled(true);
        setMicPaused(false);
      }
      return false;
    }
  }

  function sendStructuredLiveReply(session: SessionRecord, result: ExtractionResult) {
    if (!liveSessionRef.current?.isConnected()) return;

    const family = bootstrapRef.current?.families.find((item) => item.familyId === session.familyId);
    const assistantText = buildAssistantTurnText(result.spokenReply, result.nextQuestion);
    const prompt = [
      "Speak naturally in Eleanor's voice.",
      "Say the approved assistant text exactly once in substance. Do not repeat the same question in different wording.",
      "If the user's last turn included a question, make sure the reply answers it clearly before the follow-up.",
      "If the transcript seems like a pronunciation or speech-to-text mistake, infer the likely intended process/legal term only when the context is strong. If not, ask a concise confirmation question.",
      "Keep it concise and conversational. Do not add unrelated commentary.",
      family ? `Current family: ${family.familyId} — ${family.title}` : "",
      `Approved assistant text: ${assistantText}`,
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
    await processFinalAnswer(activeSession, note);
  }

  if (loadState.status === "loading") {
    return <div className="shell loading">Loading Eleanor v3…</div>;
  }

  if (loadState.status === "error") {
    return <div className="shell loading">{loadState.message}</div>;
  }

  const { data } = loadState;

  return (
    <div className={`shell ${activeSession || completedReport ? "shell-focus" : ""}`}>
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
            <button className="button button-secondary sidebar-action" onClick={() => void handleExportKnowledgePack()}>
              Export for ChatGPT
            </button>
          </div>
        </section>

        <section className="card recent-card">
          <p className="section-title">Recent Sessions</p>
          <div className="stack recent-list">
            {data.recentSessions.length === 0 ? <p className="hint">No sessions yet.</p> : null}
            {data.recentSessions.map((session) => (
              <button
                key={session.id}
                className="list-button recent-session-button"
                onClick={() => {
                  setCompletedReport(null);
                  setActiveSession(session);
                  setLastExtraction(buildExtractionPreview(session));
                  setViewMode("map");
                }}
              >
                <strong>{session.title}</strong>
                <span className="recent-meta">
                  {session.familyId} · {(session.progress[session.familyId] ?? []).length} confirmed
                </span>
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

        {viewMode === "map" ? (
          <InterviewView
            data={data}
            activeSession={activeSession}
            completedReport={completedReport}
            note={note}
            isExtracting={isExtracting}
            isFinalizing={isFinalizing}
            lastExtraction={lastExtraction}
            liveStatus={liveStatus}
            liveConnected={liveConnected}
            liveAvailable={liveRuntimeAvailable}
            liveTranscriptPreview={liveTranscriptPreview}
            micPaused={micPaused}
            provider={data.settings.provider}
            onFinishInterview={() => void handleFinishInterview()}
            onStartOver={handleStartOver}
            onCreateSession={(familyId, title) => handleCreateSession(familyId, title, false)}
            onCreateVoiceSession={(familyId, title) => handleCreateSession(familyId, title, true)}
            onChangeNote={setNote}
            onRunExtraction={handleRunExtraction}
            onStartLiveVoice={handleStartLiveVoice}
            onStopLiveVoice={handleStopLiveVoice}
            onPauseCapture={handlePauseCapture}
            onResumeCapture={handleResumeCapture}
            onToggleMute={handleToggleMute}
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
  completedReport: CompletedReport | null;
  note: string;
  isExtracting: boolean;
  isFinalizing: boolean;
  lastExtraction: ExtractionResult | null;
  liveStatus: string;
  liveConnected: boolean;
  liveAvailable: boolean;
  liveTranscriptPreview: string;
  micPaused: boolean;
  provider: AiProvider;
  onFinishInterview: () => void;
  onStartOver: () => void;
  onCreateSession: (familyId: string, title: string) => Promise<void>;
  onCreateVoiceSession: (familyId: string, title: string) => Promise<void>;
  onChangeNote: (value: string) => void;
  onRunExtraction: () => Promise<void>;
  onStartLiveVoice: () => Promise<void>;
  onStopLiveVoice: () => void;
  onPauseCapture: () => void;
  onResumeCapture: () => void;
  onToggleMute: () => void;
}) {
  const startingFamily = props.data.families[0];
  const startingTitle = startingFamily ? `${startingFamily.familyId} — ${startingFamily.title}` : "Eleanor Interview";
  const answerDraftRef = useRef<HTMLTextAreaElement | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  async function copyConversation(session: SessionRecord | null) {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(formatConversationTranscript(session));
      setCopyMessage("Conversation copied.");
    } catch {
      setCopyMessage("Copy failed. Try Export for ChatGPT instead.");
    }
  }

  if (props.completedReport && !props.activeSession) {
    const completedReport = props.completedReport;
    return (
      <section className="summary-screen">
        <article className="summary-hero">
          <p className="eyebrow">Interview Complete</p>
          <h2>{completedReport.title}</h2>
          <p>{completedReport.summary}</p>
          <p className="hint">{completedReport.aiGenerated ? "AI generated this problem-answer report from the conversation." : "Showing local fallback because AI report generation was unavailable."}</p>
          <div className="summary-actions">
            <button className="button" onClick={props.onStartOver}>Start New Interview</button>
            <button
              className="button button-secondary"
              onClick={() => void navigator.clipboard?.writeText(formatProblemAnswerReport(completedReport))}
            >
              Copy Problem / Answer
            </button>
          </div>
        </article>

        <article className="answer-card">
          <p className="section-title">Resolved Rules / Answers</p>
          <div className="problem-answer-list">
            {completedReport.problemAnswerPairs.map((pair, index) => (
              <section className="problem-answer-card" key={`${pair.problem}-${index}`}>
                <p><strong>Problem:</strong> {pair.problem}</p>
                <p><strong>Answer:</strong> {pair.answer}</p>
                {pair.evidence ? <span>{pair.evidence}</span> : null}
              </section>
            ))}
          </div>
        </article>

        <section className="summary-grid">
          <article className="answer-card">
            <p className="section-title">Key Points</p>
            <ul className="summary-list">
              {completedReport.keyPoints.map((point, index) => (
                <li key={`${point}-${index}`}>{point}</li>
              ))}
            </ul>
          </article>

          <article className="answer-card">
            <p className="section-title">Open Follow-Ups</p>
            <ul className="summary-list">
              {completedReport.openQuestions.map((question, index) => (
                <li key={`${question}-${index}`}>{question}</li>
              ))}
            </ul>
          </article>
        </section>

        {completedReport.unsavedDraft ? (
          <article className="answer-card">
            <p className="section-title">Unsaved Draft</p>
            <p>{completedReport.unsavedDraft}</p>
          </article>
        ) : null}

        <article className="history-card">
          <div className="answer-card-header">
            <div>
              <p className="eyebrow">Conversation History</p>
              <h3>{completedReport.session.transcript.length} saved turns</h3>
            </div>
            <button className="quiet-button" onClick={() => void copyConversation(completedReport.session)}>
              Copy Conversation
            </button>
          </div>
          {copyMessage ? <p className="hint success">{copyMessage}</p> : null}
          <ConversationHistory session={completedReport.session} emptyText="No conversation turns were saved." />
        </article>
      </section>
    );
  }

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">AI Meeting Notes</p>
          <h2>Record the conversation. Eleanor takes the notes.</h2>
          <p>Speak naturally. Mispronunciations are okay; Eleanor uses context to find the intended term.</p>
        </div>
      </section>

      {!props.activeSession ? (
        <section className="start-panel">
          <article className="start-card">
            <p className="eyebrow">Voice Workspace</p>
            <h2>Start recording</h2>
            <p className="start-copy">
              Click once, allow the microphone, then talk like a normal meeting.
              Eleanor listens, cleans up likely speech mistakes, keeps the transcript, and prepares a clean summary.
            </p>
            <div className="start-actions">
              <button
                className="button button-large"
                onClick={() => startingFamily && void props.onCreateVoiceSession(startingFamily.familyId, startingTitle)}
                disabled={!startingFamily || !props.liveAvailable}
              >
                Start Recording
              </button>
              <button
                className="button button-secondary"
                onClick={() => startingFamily && void props.onCreateSession(startingFamily.familyId, startingTitle)}
                disabled={!startingFamily}
              >
                Type Notes
              </button>
            </div>
            <p className="hint">
              {startingFamily
                ? `Starting with ${startingFamily.familyId}: ${startingFamily.title}`
                : "No interview families are loaded yet."}
            </p>
            {!props.liveAvailable ? <p className="danger">Voice needs OpenAI connected in Render.</p> : null}
          </article>
        </section>
      ) : (
        <section className="workspace">
          <div className="room-topbar">
            <div>
              <p className="eyebrow">Recording</p>
              <h2>{props.activeSession.title}</h2>
            </div>
            <div className="topbar-actions">
              <button className="quiet-button" onClick={() => void props.onStartLiveVoice()} disabled={!props.liveAvailable}>
                {props.liveConnected ? "Repeat" : "Start Voice"}
              </button>
              <button className="quiet-button" onClick={props.micPaused ? props.onResumeCapture : props.onPauseCapture} disabled={!props.liveConnected}>
                {props.micPaused ? "Resume" : "Pause"}
              </button>
              <button className="quiet-button" onClick={props.onToggleMute} disabled={!props.liveConnected}>
                {props.micPaused ? "Unmute" : "Mute"}
              </button>
              <button className="quiet-button" onClick={props.onFinishInterview} disabled={props.isFinalizing}>
                {props.isFinalizing ? "Summarizing..." : "Finish"}
              </button>
            </div>
          </div>

          <section className="interview-room">
            <section className="room-layout">
              <div className="conversation-main">
                <div className={`status-pill ${props.liveConnected ? "status-pill-live" : ""}`}>
                  <span>{props.provider === "openai" ? (props.liveConnected ? "Live" : "Ready") : "Typed only"}</span>
                  <p>{props.liveStatus}</p>
                </div>

                <article className={`voice-stage ${props.liveConnected ? "voice-stage-live" : ""} ${props.isExtracting ? "voice-stage-thinking" : ""}`}>
                  <div className="voice-orb" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="eyebrow">{props.isExtracting ? "Eleanor is thinking" : "Live voice"}</p>
                  <h2>{props.activeSession.currentQuestion || "Could you tell me what happens first?"}</h2>
                  <p className="hint">Keep talking naturally. If a word sounds off, Eleanor will infer it from context or ask you to confirm.</p>
                  <p className="hint">Fail-safe: live audio stops after 5 minutes without user speech or 45 minutes maximum.</p>
                </article>

                <article className="answer-card">
                  <div className="answer-card-header">
                    <div>
                      <p className="eyebrow">Live Transcript</p>
                      <h3>{props.liveTranscriptPreview ? "I can hear you." : "Start speaking whenever you're ready."}</h3>
                    </div>
                    <button className="quiet-button" onClick={() => answerDraftRef.current?.focus()} disabled={props.isExtracting}>
                      Edit Transcript
                    </button>
                  </div>

                  <div className="live-transcript-line">
                    <span>Live transcript</span>
                    <p>{props.liveTranscriptPreview || "Waiting for your voice..."}</p>
                  </div>

                  <textarea
                    ref={answerDraftRef}
                    className="textarea answer-textarea"
                    value={props.note}
                    onChange={(event) => props.onChangeNote(event.target.value)}
                    placeholder="If you need to fix or type an answer, use this box. Otherwise just keep talking."
                  />

                  <div className="next-row">
                    <button className="button button-large next-button" onClick={() => void props.onRunExtraction()} disabled={props.isExtracting || !props.note.trim() || !props.data.hasApiKey}>
                      {props.isExtracting ? "Thinking..." : "Send now"}
                    </button>
                    <p>{props.isExtracting ? "Eleanor is updating memory and preparing one next question." : "Usually you can just talk. Use Send now only if you typed or corrected something."}</p>
                  </div>
                </article>

                <details className="quiet-panel">
                  <summary>More controls and notes</summary>
                  <div className="quiet-panel-grid">
                    <button className="button button-secondary" onClick={props.onResumeCapture} disabled={!props.liveConnected || !props.micPaused}>
                      Resume
                    </button>
                    <button className="button button-secondary" onClick={props.onStopLiveVoice} disabled={!props.liveConnected}>
                      Stop Audio
                    </button>
                    <button className="button button-secondary" disabled={props.isExtracting}>
                      Skip / Park
                    </button>
                    <button className="button button-secondary" disabled={props.isExtracting}>
                      Go Back
                    </button>
                    <button className="button button-secondary" disabled={!props.lastExtraction}>
                      Show Current Entry
                    </button>
                    <button className="button button-secondary" disabled={!props.lastExtraction}>
                      What Is Missing?
                    </button>
                    <button className="button button-secondary" disabled={props.isExtracting}>
                      Commit Current Family
                    </button>
                    <button className="button button-danger" onClick={props.onFinishInterview} disabled={props.isExtracting || props.isFinalizing}>
                      {props.isFinalizing ? "Summarizing..." : "Finish Interview"}
                    </button>
                  </div>
                </details>
              </div>

              <aside className="history-card history-panel">
                <div className="answer-card-header">
                  <div>
                    <p className="eyebrow">Conversation History</p>
                    <h3>{props.activeSession.transcript.length === 0 ? "No saved turns yet." : `${props.activeSession.transcript.length} saved turns`}</h3>
                  </div>
                  <button className="quiet-button" onClick={() => void copyConversation(props.activeSession)}>
                    Copy
                  </button>
                </div>
                {copyMessage ? <p className="hint success">{copyMessage}</p> : null}
                <ConversationHistory session={props.activeSession} emptyText="The full conversation will appear here as Eleanor and Jack speak." />
              </aside>
            </section>
          </section>
        </section>
      )}
    </>
  );
}

function ConversationHistory(props: { session: SessionRecord; emptyText: string }) {
  if (props.session.transcript.length === 0) {
    return <p className="hint">{props.emptyText}</p>;
  }

  return (
    <div className="transcript history-list">
      {props.session.transcript.map((entry, index) => (
        <div key={entry.id} className={`bubble bubble-${entry.role}`}>
          <span>{index + 1}. {entry.role} · {formatDateTime(entry.createdAt)}</span>
          <p>{entry.text}</p>
        </div>
      ))}
    </div>
  );
}
