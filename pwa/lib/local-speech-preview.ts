type SpeechResult = { 0: { transcript: string }; isFinal: boolean };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
export type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  start: () => void;
  abort: () => void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
export type RecognitionCtor = (new () => Recognition) & {
  available?: (options: {
    langs: string[];
    processLocally: boolean;
  }) => Promise<string>;
};

/** Owns one on-device recognizer and invalidates pending starts on stop. */
export class LocalSpeechPreview {
  private generation = 0;
  private recognition: Recognition | null = null;

  stop() {
    // Invalidate even when availability is pending and no engine exists yet.
    this.generation++;
    const current = this.recognition;
    this.recognition = null;
    if (!current) return;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    try {
      current.abort();
    } catch {
      // Already stopped.
    }
  }

  async start(
    Ctor: RecognitionCtor | undefined,
    lang: string,
    isRecording: () => boolean,
    onResult: (settled: string, tail: string) => void,
  ) {
    this.stop();
    const generation = this.generation;
    if (typeof Ctor?.available !== 'function') return;
    try {
      const status = await Ctor.available({
        langs: [lang],
        processLocally: true,
      });
      // Never download a model or fall back to a remote speech service.
      if (
        status !== 'available' ||
        generation !== this.generation ||
        !isRecording()
      )
        return;

      const engine = new Ctor();
      this.recognition = engine;
      engine.continuous = true;
      engine.interimResults = true;
      engine.lang = lang;
      engine.processLocally = true;
      let confirmed = '';
      engine.onresult = (event) => {
        // A previously queued callback must not update a later recording.
        if (generation !== this.generation || !isRecording()) return;
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) confirmed += result[0].transcript;
          else interim += result[0].transcript;
        }
        onResult(confirmed, interim);
      };
      engine.onerror = () => {};
      engine.onend = () => {};
      engine.start();
    } catch {
      // Only this request may clean up its engine; a stale failure must not
      // abort a newer recording's preview.
      if (generation === this.generation) this.stop();
    }
  }
}
