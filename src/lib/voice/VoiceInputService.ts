import { computeAdaptiveConfidenceThreshold, passesConfidenceGate } from './confidence';
import { resolveVoiceErrorMessage, shouldAutoRestartAfterError } from './errors';
import { NoiseMonitor } from './noiseMonitor';
import { getSpeechRecognitionCtor } from './speechRecognition';
import type {
  SpeechRecognitionErrorCode,
  SpeechRecognitionEventLike,
  SpeechRecognitionInstance,
  TranscriptMeta,
  VoiceInputCallbacks,
  VoiceInputMode,
  VoiceInputState,
  VoiceInputTargetContext,
  VoicePermissionState,
} from './types';
import type { VoiceInputSettings } from './voiceSettings';
import { claimVoiceSession, releaseVoiceSession, type VoiceSessionHandle } from './voiceSessionCoordinator';

const INITIAL_STATE: VoiceInputState = {
  listeningState: 'idle',
  isListening: false,
  isSupported: false,
  permission: 'unknown',
  mode: 'toggle',
  noiseLevel: 0,
  confidence: null,
  confidenceThreshold: 0.55,
  interimText: '',
  committedText: '',
  restartCount: 0,
  errorMessage: null,
  errorCode: null,
};

/**
 * Encapsulates Web Speech API recognition, noise monitoring, adaptive confidence,
 * auto-restart, and cleanup for Merlin repair-line voice entry.
 */
export class VoiceInputService {
  private recognition: SpeechRecognitionInstance | null = null;
  private noiseMonitor = new NoiseMonitor((level) => this.handleNoiseLevel(level));
  private state: VoiceInputState = { ...INITIAL_STATE };
  private callbacks: VoiceInputCallbacks | null = null;
  private target: VoiceInputTargetContext | null = null;
  private targetElement: HTMLTextAreaElement | HTMLInputElement | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private userStopped = false;
  private destroyed = false;
  /** C7: true while intentionally replacing a recognizer — ignore its aborted/error callbacks. */
  private supersedingRecognition = false;
  private readonly sessionHandle: VoiceSessionHandle = {
    stop: () => this.stop(),
  };

  constructor(private readonly settings: VoiceInputSettings) {
    this.state.isSupported = getSpeechRecognitionCtor() != null;
    this.state.mode = settings.pushToTalkDefault ? 'push-to-talk' : 'toggle';
    this.state.confidenceThreshold = settings.baseConfidenceThreshold;
  }

  getState(): VoiceInputState {
    return { ...this.state };
  }

  setMode(mode: VoiceInputMode): void {
    this.patchState({ mode });
  }

  async refreshPermission(): Promise<VoicePermissionState> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.patchState({ permission: 'denied' });
      return 'denied';
    }
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const permission = status.state as VoicePermissionState;
      this.patchState({ permission });
      status.onchange = () => {
        this.patchState({ permission: status.state as VoicePermissionState });
      };
      return permission;
    } catch {
      this.patchState({ permission: 'unknown' });
      return 'unknown';
    }
  }

  /**
   * Begin listening at the caret position in the target field.
   * Returns false when SpeechRecognition is unavailable.
   */
  async start(
    element: HTMLTextAreaElement | HTMLInputElement,
    callbacks: VoiceInputCallbacks
  ): Promise<boolean> {
    if (this.destroyed) return false;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.patchState({ listeningState: 'unsupported', isListening: false });
      return false;
    }

    this.clearTimers();
    this.userStopped = false;
    // C6: stop any other field's voice session before claiming the mic.
    claimVoiceSession(this.sessionHandle);
    this.callbacks = callbacks;
    this.targetElement = element;

    const selectionStart = element.selectionStart ?? element.value.length;
    const selectionEnd = element.selectionEnd ?? element.value.length;
    this.target = {
      prefix: element.value.slice(0, selectionStart),
      suffix: element.value.slice(selectionEnd),
      committed: '',
      selectionStart,
      selectionEnd,
    };

    this.patchState({
      listeningState: 'requesting-permission',
      errorMessage: null,
      errorCode: null,
      interimText: '',
      committedText: '',
      restartCount: 0,
    });

    try {
      await this.noiseMonitor.start(this.settings);
      await this.refreshPermission();
    } catch {
      await this.noiseMonitor.stop();
      this.patchState({
        listeningState: 'error',
        isListening: false,
        permission: 'denied',
        errorCode: 'not-allowed',
        errorMessage: resolveVoiceErrorMessage('not-allowed'),
      });
      callbacks.onError?.('not-allowed', resolveVoiceErrorMessage('not-allowed'));
      return false;
    }

    const started = this.startRecognition(Ctor);
    if (!started) {
      // H13: release mic stream when SpeechRecognition fails to start.
      await this.noiseMonitor.stop();
    }
    return started;
  }

  /** Stop recognition gracefully (final results may still flush). */
  stop(): void {
    this.userStopped = true;
    this.clearTimers();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        this.disposeRecognition();
      }
    }
    releaseVoiceSession(this.sessionHandle);
    void this.noiseMonitor.stop();
    this.patchState({
      isListening: false,
      listeningState: 'idle',
      interimText: '',
    });
  }

  /** Immediate teardown — used on unmount/navigation. */
  destroy(): void {
    this.destroyed = true;
    this.userStopped = true;
    this.clearTimers();
    this.disposeRecognition();
    releaseVoiceSession(this.sessionHandle);
    void this.noiseMonitor.stop();
    this.callbacks = null;
    this.target = null;
    this.targetElement = null;
    this.state = { ...INITIAL_STATE, isSupported: getSpeechRecognitionCtor() != null };
  }

  /** Retry after listening timeout or error UX. */
  async retry(): Promise<boolean> {
    if (!this.targetElement || !this.callbacks) return false;
    this.patchState({ restartCount: 0, errorMessage: null, errorCode: null });
    return this.start(this.targetElement, this.callbacks);
  }

  private startRecognition(Ctor: NonNullable<ReturnType<typeof getSpeechRecognitionCtor>>): boolean {
    // C7: detach handlers before abort so superseded instances cannot schedule restarts.
    this.disposeRecognition();

    const recognition = new Ctor();
    recognition.continuous = this.settings.continuous;
    recognition.interimResults = true;
    recognition.lang = this.settings.language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.patchState({ listeningState: 'listening', isListening: true });
      this.resetListeningTimeout();
    };

    recognition.onresult = (event) => this.handleResult(event);

    recognition.onerror = (event) => {
      const code = event.error;
      if (code === 'aborted' && (this.userStopped || this.supersedingRecognition)) return;

      const message = resolveVoiceErrorMessage(code);
      this.patchState({
        errorCode: code,
        errorMessage: message,
      });
      this.callbacks?.onError?.(code, message);

      const canRestart =
        this.state.mode === 'toggle' &&
        this.settings.continuous &&
        !this.userStopped &&
        shouldAutoRestartAfterError(code, this.state.restartCount, this.settings.maxAutoRestarts);

      if (canRestart) {
        this.scheduleRestart();
      } else if (code !== 'aborted') {
        this.patchState({ listeningState: 'error', isListening: false });
      }
    };

    recognition.onend = () => {
      if (this.userStopped || this.destroyed || this.supersedingRecognition) {
        this.patchState({ isListening: false, listeningState: 'idle', interimText: '' });
        return;
      }

      const shouldRestart =
        this.state.mode === 'toggle' &&
        this.settings.continuous &&
        this.state.restartCount < this.settings.maxAutoRestarts;

      if (shouldRestart) {
        this.scheduleRestart();
      } else {
        this.patchState({ isListening: false, listeningState: 'idle', interimText: '' });
      }
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.patchState({ isListening: true, listeningState: 'listening' });
      this.resetListeningTimeout();
      return true;
    } catch {
      void this.noiseMonitor.stop();
      this.patchState({ listeningState: 'error', isListening: false });
      return false;
    }
  }

  private handleResult(event: SpeechRecognitionEventLike): void {
    if (!this.target || !this.callbacks) return;

    this.resetListeningTimeout();

    let interim = '';
    let batchConfidence: number | null = null;
    let hasFinal = false;
    const threshold = computeAdaptiveConfidenceThreshold(this.state.noiseLevel, this.settings);

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const alternative = result[0];
      if (!alternative) continue;

      const confidence = alternative.confidence;
      if (confidence != null && !Number.isNaN(confidence)) {
        batchConfidence = batchConfidence == null ? confidence : Math.max(batchConfidence, confidence);
      }

      if (!passesConfidenceGate(confidence, threshold)) continue;

      const text = alternative.transcript ?? '';
      if (result.isFinal) {
        this.target.committed += text;
        hasFinal = true;
      } else {
        interim += text;
      }
    }

    const full = this.target.prefix + this.target.committed + interim + this.target.suffix;
    const meta: TranscriptMeta = {
      committed: this.target.committed,
      interim,
      full,
      hasFinal,
      confidence: batchConfidence,
    };

    this.patchState({
      interimText: interim,
      committedText: this.target.committed,
      confidence: batchConfidence,
      confidenceThreshold: threshold,
      listeningState: 'listening',
    });

    this.callbacks.onTranscript(full, meta);

    if (this.targetElement) {
      const cursor = this.target.prefix.length + this.target.committed.length + interim.length;
      requestAnimationFrame(() => {
        try {
          this.targetElement?.setSelectionRange(cursor, cursor);
        } catch {
          // ignore selection errors on disabled/readOnly fields
        }
      });
    }
  }

  private handleNoiseLevel(level: number): void {
    const threshold = computeAdaptiveConfidenceThreshold(level, this.settings);
    this.patchState({ noiseLevel: level, confidenceThreshold: threshold });
  }

  private scheduleRestart(): void {
    this.clearRestartTimer();
    const nextCount = this.state.restartCount + 1;
    this.patchState({ listeningState: 'restarting', restartCount: nextCount, interimText: '' });

    this.restartTimer = setTimeout(() => {
      if (this.userStopped || this.destroyed) return;
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;
      this.startRecognition(Ctor);
    }, this.settings.silenceRestartDelayMs);
  }

  private resetListeningTimeout(): void {
    this.clearTimeoutTimer();
    this.timeoutTimer = setTimeout(() => {
      if (this.userStopped || !this.state.isListening) return;
      this.userStopped = true;
      this.recognition?.stop();
      void this.noiseMonitor.stop();
      this.patchState({
        isListening: false,
        listeningState: 'timeout',
        errorMessage: 'Listening timed out. Tap Retry or use the keyboard.',
        errorCode: 'no-speech',
      });
    }, this.settings.listeningTimeoutMs);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearRestartTimer();
    this.clearTimeoutTimer();
  }

  /** C7: detach event handlers then abort — prevents ghost onend/onerror restart loops. */
  private disposeRecognition(): void {
    const recognition = this.recognition;
    if (!recognition) return;

    this.supersedingRecognition = true;
    this.recognition = null;
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;

    try {
      recognition.abort();
    } catch {
      // ignore — browser may already be tearing down
    }

    this.supersedingRecognition = false;
  }

  private patchState(patch: Partial<VoiceInputState>): void {
    this.state = { ...this.state, ...patch };
    this.callbacks?.onStateChange?.(this.getState());
  }
}