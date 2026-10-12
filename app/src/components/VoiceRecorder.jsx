import { useEffect, useRef, useState } from 'react';
import { T } from '../tokens';

export function VoiceRecorder({ disabled, onRecorded, onRecordingChange }) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const session = useRef(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (session.current) {
        session.current.recorder.onstop = null;
        if (session.current.recorder.state !== 'inactive') session.current.recorder.stop();
        session.current.stream.getTracks().forEach(track => track.stop());
        clearTimeout(session.current.timer);
      }
    };
  }, []);

  async function start() {
    if (starting || recording || disabled) return;
    setError(null);
    setStarting(true);
    onRecordingChange(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Recording is unavailable in this browser. Use Add Audio to choose a recording.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      let recorder;
      try { recorder = new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(track => track.stop()); throw e; }
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        clearTimeout(session.current?.timer);
        session.current = null;
        if (!mounted.current) return;
        setRecording(false);
        onRecordingChange(false);
        const mime = recorder.mimeType.split(';')[0] || 'audio/webm';
        const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(chunks, { type: mime });
        if (blob.size) onRecorded(new File([blob], 'voice-' + Date.now() + '.' + extension, { type: mime }));
      };
      recorder.onerror = () => {
        setError('Recording stopped unexpectedly. Check the clip before saving.');
        if (recorder.state !== 'inactive') recorder.stop();
      };
      session.current = { recorder, stream, timer: null };
      recorder.start(1000);
      session.current.timer = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 5 * 60 * 1000);
      setRecording(true);
    } catch (e) {
      session.current?.stream.getTracks().forEach(track => track.stop());
      clearTimeout(session.current?.timer);
      session.current = null;
      if (mounted.current) {
        setError(e.name === 'NotAllowedError' ? 'Microphone access was declined. You can still add an audio file.' : e.message);
        onRecordingChange(false);
      }
    } finally { if (mounted.current) setStarting(false); }
  }

  return <div style={{ marginBottom: 12 }}>
    <button type="button" disabled={starting || (disabled && !recording)}
      onClick={() => recording ? session.current?.recorder.stop() : void start()}
      style={{ minHeight: 48, padding: '10px 16px', borderRadius: 10, border: 'none',
        background: recording ? '#A52A2A' : T.accent, color: 'white', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
      {starting ? 'Opening microphone…' : recording ? 'Stop recording' : 'Record voice'}
    </button>
    <p role="status" style={{ fontSize: 13, color: T.textSub, marginTop: 6 }}>
      {recording ? 'Recording… stops automatically after 5 minutes.' : 'Record up to 5 minutes, or add an audio file below.'}
    </p>
    {error && <p role="alert" style={{ color: '#8A1414', fontSize: 14 }}>{error}</p>}
  </div>;
}
