"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function getSupportedMimeType(): string | undefined {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return undefined;
  }

  for (const mimeType of MIME_TYPE_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return undefined;
}

function canRecordAudio(): boolean {
  if (typeof window === "undefined") return false;
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function subscribeToRecordingSupport() {
  return () => {};
}

function getFriendlyRecordingError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Microphone access was blocked. Allow mic access in your browser.";
    }
    if (error.name === "NotFoundError") {
      return "No working microphone was detected.";
    }
    if (error.name === "NotReadableError") {
      return "Your microphone is busy in another app or browser tab.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Microphone recording failed.";
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isSupported = useSyncExternalStore(
    subscribeToRecordingSupport,
    canRecordAudio,
    () => false,
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string | undefined>(undefined);

  const stopTracks = useCallback(() => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      stopTracks();
    };
  }, [stopTracks]);

  const start = useCallback(async () => {
    if (!canRecordAudio()) {
      setError("Speech input is not available in this browser.");
      return;
    }

    setError(null);
    setTranscript("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      mimeTypeRef.current = mimeType;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setError("Microphone recording failed.");
        setIsListening(false);
        setIsProcessing(false);
        stopTracks();
      };

      recorder.onstop = async () => {
        setIsListening(false);
        stopTracks();

        const audioBlob = chunksRef.current.length > 0
          ? new Blob(chunksRef.current, { type: mimeTypeRef.current ?? "audio/webm" })
          : null;
        chunksRef.current = [];

        if (!audioBlob || audioBlob.size === 0) {
          setError("I couldn't hear anything. Try again, then press Send.");
          return;
        }

        setIsProcessing(true);
        try {
          const formData = new FormData();
          formData.append("file", audioBlob, `recording.${(mimeTypeRef.current ?? "audio/webm").includes("ogg") ? "ogg" : "webm"}`);

          const res = await fetch("/api/speech/transcribe", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            throw new Error(await res.text());
          }

          const data = (await res.json()) as { text?: string };
          const text = data.text?.trim() ?? "";
          if (!text) {
            setError("I couldn't understand that recording. Try again.");
            return;
          }

          setTranscript(text);
          setError(null);
        } catch (err) {
          setError(getFriendlyRecordingError(err));
        } finally {
          setIsProcessing(false);
        }
      };

      recorder.start();
      setIsListening(true);
    } catch (err) {
      setError(getFriendlyRecordingError(err));
      setIsListening(false);
      setIsProcessing(false);
      stopTracks();
    }
  }, [stopTracks]);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  return { isListening, isProcessing, transcript, isSupported, error, start, stop, reset };
}
