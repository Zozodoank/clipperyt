import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import DependenciesStatus from './components/DependenciesStatus';
import InputCard from './components/InputCard';
import ProgressCard from './components/ProgressCard';
import VideoPlayer from './components/VideoPlayer';
import CaptionCard from './components/CaptionCard';
import VoiceoverUploader from './components/VoiceoverUploader';
import SettingsModal from './components/SettingsModal';
import JobHistoryPanel from './components/JobHistoryPanel';
import AutoModePanel from './components/AutoModePanel';
import ErrorBoundary from './components/ErrorBoundary';
import { Sparkles, Clapperboard } from 'lucide-react';

export default function App() {
  const [formData, setFormData] = useState(() => ({
    youtubeUrl: '',
    shopeeLink: '',
    productTitle: '',
    productDescription: '',
    model: 'gpt-4o-mini',
  }));

  const [settings, setSettings] = useState({
    aiProvider: 'gemini',
    ttsProvider: 'gemini_tts',
    ttsModel: 'gemini-3.1-flash-tts-preview',
    ttsFallbackModel: 'gemini-2.5-flash-preview-tts',
    ttsVoice: 'Despina',
    sceneDuration: 3.3,
    renderMode: 'stage_80',
    aspectRatio: '16:9',
    hflip: false,
    speedMultiplier: 1,
    enableSubtitles: true,
    voice: 'Despina',
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [progressState, setProgressState] = useState({
    step: 'idle', message: '', progress: 0, status: 'idle',
    error: null, isQuotaError: false, canRetry: false,
  });

  const [result, setResult] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [checkingEngine, setCheckingEngine] = useState(false);
  const [historyRefreshSignal, setHistoryRefreshSignal] = useState(0);

  const lastJobIdRef = useRef(null);
  const lastFormDataRef = useRef(null);
  const eventSourceRef = useRef(null);

  const fetchEngineHealth = async () => {
    setCheckingEngine(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setEngineStatus(data);
        setSettings((prev) => ({
          ...prev,
          ...(data.activeAiEngine && data.activeAiEngine !== 'none' ? { aiProvider: prev.aiProvider || data.activeAiEngine } : {}),
          ...(data.tts ? {
            ttsProvider: prev.ttsProvider || data.tts.provider || 'gemini_tts',
            ttsModel: prev.ttsModel || data.tts.model || 'gemini-3.1-flash-tts-preview',
            ttsFallbackModel: prev.ttsFallbackModel || data.tts.fallbackModel || 'gemini-2.5-flash-preview-tts',
            ttsVoice: prev.ttsVoice || data.tts.voice || 'Despina',
          } : {})
        }));
      }
    } catch (err) {
      console.warn('Could not fetch backend health:', err.message);
    } finally {
      setCheckingEngine(false);
    }
  };

  useEffect(() => { fetchEngineHealth(); }, []);

  // Core pipeline runner (used by fresh runs, retries, and history resumes)
  const runGeneratePipeline = async (overrideJobId = null, overrideFormData = null) => {
    const currentForm = overrideFormData || lastFormDataRef.current || formData;
    const jobId = overrideJobId || Math.random().toString(36).substring(2, 10);
    lastJobIdRef.current = jobId;

    setIsLoading(true);
    setResult(null);

    const activeEngineName = (settings.aiProvider === 'gemini' || engineStatus?.activeAiEngine === 'gemini')
      ? 'Gemini File API + Gemini'
      : 'FFmpeg + OpenRouter';

    setProgressState({
      step: 'start',
      message: isRetrying
        ? `Mencoba ulang dari tahap yang terhenti (Retry)...`
        : `Memulai Tahap 1: Analisis AI (${activeEngineName})...`,
      progress: 5, status: 'running', error: null, isQuotaError: false, canRetry: false,
    });

    if (eventSourceRef.current) eventSourceRef.current.close();

    const sse = new EventSource(`/api/progress/${jobId}`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setProgressState((prev) => ({
          ...prev,
          step: data.step || prev.step,
          message: data.message || prev.message,
          progress: data.progress !== undefined ? data.progress : prev.progress,
          status: data.status || prev.status,
          error: data.error || null,
          isQuotaError: data.isQuotaError || false,
          canRetry: data.canRetry || false,
          coreProductNoun: data.coreProductNoun || prev.coreProductNoun,
        }));
        if ((data.status === 'awaiting_voiceover' || data.status === 'completed') && data.result) {
          setResult(data.result);
          setIsLoading(false);
          sse.close();
        } else if (data.status === 'error') {
          setIsLoading(false);
          sse.close();
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };
    sse.onerror = () => sse.close();

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          youtubeUrl: currentForm.youtubeUrl,
          shopeeLink: currentForm.shopeeLink,
          productTitle: currentForm.productTitle,
          productDescription: currentForm.productDescription,
          aiProvider: settings.aiProvider || engineStatus?.activeAiEngine || 'gemini',
          options: {
            ...settings,
            aiProvider: settings.aiProvider || engineStatus?.activeAiEngine || 'gemini',
          },
        }),
      });

      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(
          response.ok
            ? `Respon server tidak valid: ${rawText.slice(0, 200)}`
            : `Server Backend Error (${response.status}): Pastikan 'npm run dev' berjalan.`
        );
      }

      if (!response.ok || !data.jobId) throw new Error(data.error || 'Gagal memproses Tahap 1.');

      setResult(data);
      setProgressState((prev) => ({
        ...prev, step: 'awaiting_voiceover',
        message: 'Tahap 1 Selesai! Upload voiceover dari AI Studio untuk finalisasi.',
        progress: 100, status: 'awaiting_voiceover', error: null, canRetry: false,
      }));
    } catch (err) {
      const isQuotaError = ['saldo', 'insufficient', 'balance', 'quota', 'credit'].some(k =>
        err.message.toLowerCase().includes(k)
      );
      setProgressState((prev) => ({
        ...prev, step: 'error', message: err.message || 'Proses gagal.',
        progress: prev.progress, status: 'error', error: err.message, isQuotaError, canRetry: true,
      }));
    } finally {
      setIsLoading(false);
      if (eventSourceRef.current) eventSourceRef.current.close();
    }
  };

  // Fresh generate
  const handleGenerate = async () => {
    if (!formData.productTitle) return alert('Silakan masukkan Judul / Nama Produk.');
    if (!formData.youtubeUrl) return alert('Silakan masukkan YouTube Video URL.');
    if (!formData.shopeeLink) return alert('Silakan masukkan link Shopee Affiliate Anda.');
    lastFormDataRef.current = { ...formData };
    await runGeneratePipeline(null);
  };

  // Retry with same jobId (server reuses cached video)
  const handleRetry = async () => {
    await runGeneratePipeline(lastJobIdRef.current);
  };

  // Select a job from Job History Panel (retry / resume / view)
  const handleSelectJob = (job) => {
    lastJobIdRef.current = job.jobId;

    // Restore form data from persisted job
    const restoredForm = {
      ...formData,
      youtubeUrl: job.youtubeUrl || formData.youtubeUrl,
      shopeeLink: job.shopeeLink || formData.shopeeLink,
      productTitle: job.productTitle || formData.productTitle,
      productDescription: job.productDescription || formData.productDescription,
    };
    setFormData(restoredForm);
    lastFormDataRef.current = restoredForm;

    // If job is currently running or auto-retrying, connect to live progress SSE
    if (job.isAutoRetrying || job.stage === 'running') {
      setIsLoading(true);
      setResult(null);
      setProgressState({
        step: 'auto_retry',
        message: `Memantau pencarian video cocok persis untuk "${job.productTitle || job.jobId}"...`,
        progress: 10,
        status: 'running',
        error: null,
        isAutoRetrying: true,
      });

      if (eventSourceRef.current) eventSourceRef.current.close();
      const sse = new EventSource(`/api/progress/${job.jobId}`);
      eventSourceRef.current = sse;

      sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setProgressState((prev) => ({
            ...prev,
            step: data.step || prev.step,
            message: data.message || prev.message,
            progress: data.progress !== undefined ? data.progress : prev.progress,
            status: data.status || prev.status,
            error: data.error || null,
            isQuotaError: data.isQuotaError || false,
            canRetry: data.canRetry || false,
            isAutoRetrying: data.isAutoRetrying !== undefined ? data.isAutoRetrying : prev.isAutoRetrying,
            attemptCount: data.attemptCount || prev.attemptCount,
          }));

          if ((data.status === 'awaiting_voiceover' || data.status === 'completed') && data.result) {
            setResult(data.result);
            setIsLoading(false);
            sse.close();
            setHistoryRefreshSignal((v) => v + 1);
          } else if (data.status === 'error') {
            setIsLoading(false);
            sse.close();
            setHistoryRefreshSignal((v) => v + 1);
          }
        } catch (e) {
          console.error('Error parsing SSE in handleSelectJob:', e);
        }
      };
      sse.onerror = () => sse.close();
      return;
    }

    // If job is already done or has clips/scenes, restore all data directly
    const hasFinal = job.stage === 'completed' || Boolean(job.hasFinalVideo);
    const hasSilent = job.stage === 'awaiting_voiceover' || Boolean(job.hasSilentVideo);
    const hasContent = hasFinal || hasSilent || (Array.isArray(job.scenes) && job.scenes.length > 0);

    if (hasContent) {
      const activeStage = hasFinal ? 'completed' : 'awaiting_voiceover';
      setResult({
        ...job,
        stage: activeStage,
        videoUrl: job.videoUrl || job.finalVideoUrl || (hasFinal ? `/api/video/final_clip_${job.jobId}.mp4` : null),
        downloadUrl: job.downloadUrl || job.finalVideoUrl || (hasFinal ? `/api/download/final_clip_${job.jobId}.mp4` : null),
        silentVideoUrl: job.silentVideoUrl || `/api/video/silent_clip_${job.jobId}.mp4`,
        finalLocalPath: job.finalLocalPath || `server/output/final_clip_${job.jobId}.mp4`,
        silentLocalPath: job.silentLocalPath || `server/output/silent_clip_${job.jobId}.mp4`,
      });
      setProgressState({
        step: activeStage,
        message: hasFinal
          ? 'Video Final & seluruh data pemasaran siap digunakan untuk Reels.'
          : 'Kotak Scene & Naskah tersedia. Upload voiceover untuk finalisasi.',
        progress: 100,
        status: activeStage,
        error: null,
        canRetry: false,
        isAutoRetrying: false,
      });
      return;
    }

    if (job.stage === 'error' || job.stage === 'interrupted') {
      setResult(null);
      setProgressState({
        step: 'error',
        message: job.lastError || `Job sebelumnya terhenti (${job.stage}). Klik tombol Retry untuk mencoba lagi.`,
        progress: 100,
        status: 'error',
        error: job.lastError || `Job terhenti pada tahap: ${job.stage}`,
        canRetry: true,
        isAutoRetrying: false,
      });
      return;
    }

    // Otherwise retry the pipeline
    runGeneratePipeline(job.jobId, restoredForm);
  };

  const handleStopCurrentAutoRetry = async () => {
    const jobId = lastJobIdRef.current;
    if (!jobId) return;
    try {
      await fetch(`/api/jobs/${jobId}/auto-retry/stop`, { method: 'POST' });
      setProgressState((prev) => ({
        ...prev,
        isAutoRetrying: false,
        message: 'Menghentikan Auto Retry...',
      }));
      setHistoryRefreshSignal((v) => v + 1);
    } catch (err) {
      console.warn('Could not stop auto retry:', err);
    }
  };

  const handleRetryJob = async (job) => {
    const isCompleted = job.stage === 'completed';
    const confirmMsg = isCompleted
      ? `Generate ulang job "${job.productTitle || job.jobId}"?\n\nVideo lama dan voiceover yang kualitasnya kurang baik akan dihapus dan diganti secara otomatis dengan video source 1080p baru & voiceover baru.`
      : `Generate ulang job "${job.productTitle || job.jobId}" dari awal?`;

    if (!window.confirm(confirmMsg)) return;

    lastJobIdRef.current = job.jobId;

    const restoredForm = {
      ...formData,
      youtubeUrl: job.youtubeUrl || formData.youtubeUrl,
      shopeeLink: job.shopeeLink || formData.shopeeLink,
      productTitle: job.productTitle || formData.productTitle,
      productDescription: job.productDescription || formData.productDescription,
    };
    setFormData(restoredForm);
    lastFormDataRef.current = restoredForm;

    setIsLoading(true);
    setResult(null);

    setProgressState({
      step: 'retry_start',
      message: `Menyiapkan generate ulang untuk "${job.productTitle || job.jobId}" (Source 1080p & Voiceover Baru)...`,
      progress: 5,
      status: 'running',
      error: null,
      isQuotaError: false,
      canRetry: false,
    });

    if (eventSourceRef.current) eventSourceRef.current.close();

    const sse = new EventSource(`/api/progress/${job.jobId}`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setProgressState((prev) => ({
          ...prev,
          step: data.step || prev.step,
          message: data.message || prev.message,
          progress: data.progress !== undefined ? data.progress : prev.progress,
          status: data.status || prev.status,
          error: data.error || null,
          isQuotaError: data.isQuotaError || false,
          canRetry: data.canRetry || false,
          coreProductNoun: data.coreProductNoun || prev.coreProductNoun,
        }));

        if ((data.status === 'awaiting_voiceover' || data.status === 'completed') && data.result) {
          setResult(data.result);
          setIsLoading(false);
          sse.close();
          setHistoryRefreshSignal((v) => v + 1);
        } else if (data.status === 'error') {
          setIsLoading(false);
          sse.close();
          setHistoryRefreshSignal((v) => v + 1);
        }
      } catch (e) {
        console.error('Error parsing SSE event in handleRetryJob:', e);
      }
    };
    sse.onerror = () => sse.close();

    try {
      const res = await fetch(`/api/jobs/${job.jobId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceNewCandidate: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal memulai retry pada server.');
      }
    } catch (err) {
      setProgressState((prev) => ({
        ...prev,
        step: 'error',
        message: err.message || 'Gagal generate ulang.',
        status: 'error',
        error: err.message,
        canRetry: true,
      }));
      setIsLoading(false);
      if (eventSourceRef.current) eventSourceRef.current.close();
    }
  };

  const handleVoiceoverUploadSuccess = (finalData) => {
    setResult(finalData);
    setProgressState({
      step: 'completed', message: 'Tahap 2 Selesai! Video Final siap diunduh.',
      progress: 100, status: 'completed', error: null, canRetry: false,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#070b14] text-slate-100 selection:bg-red-600 selection:text-white">
      {/* Prominent Distinction Banner: YTCLIPER 16:9 Landscape Review Engine */}
      <div className="bg-gradient-to-r from-red-700 via-rose-700 to-red-800 text-white text-xs font-bold px-4 py-2 flex items-center justify-between border-b border-red-500/40 shadow-md">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
          <span className="uppercase tracking-wider font-extrabold text-white">🔴 YTCLIPER: YOUTUBE 16:9 TECH REVIEW ENGINE</span>
          <span className="bg-black/40 text-red-200 px-2 py-0.5 rounded text-[10px] font-mono border border-red-400/30">
            HP 2 JUTAAN+ &bull; ANDROID 16+ &bull; KAMERA DEPAN-BELAKANG
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[11px] text-red-100 font-medium">
          <span>Format: 16:9 Landscape YouTube Layout</span>
          <span className="text-red-300">&bull;</span>
          <span>Durasi: 50–59 Detik</span>
          <span className="text-red-300">&bull;</span>
          <span className="bg-red-950/60 text-red-200 px-2 py-0.5 rounded border border-red-400/40">CTA: Link di Deskripsi Video</span>
        </div>
      </div>

      <Navbar onOpenSettings={() => setIsSettingsOpen(true)} engineStatus={engineStatus} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <DependenciesStatus status={engineStatus} onRefresh={fetchEngineHealth} loading={checkingEngine} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* Left Column */}
          <div className="lg:col-span-6 space-y-6">
            {/* Job History Panel — above the form */}
            <AutoModePanel
              settings={settings}
              onHistoryRefresh={() => setHistoryRefreshSignal((value) => value + 1)}
            />

            <JobHistoryPanel
              onSelectJob={handleSelectJob}
              onRetryJob={handleRetryJob}
              currentJobId={lastJobIdRef.current}
              refreshSignal={historyRefreshSignal}
              settings={settings}
            />

            <InputCard
              formData={formData}
              setFormData={setFormData}
              onGenerate={handleGenerate}
              isLoading={isLoading}
              settings={settings}
              engineStatus={engineStatus}
              onOpenSettings={() => setIsSettingsOpen(true)}
            />

            {(isLoading || progressState.status !== 'idle') && (
              <ProgressCard
                progressState={progressState}
                onRetry={handleRetry}
                onStopAutoRetry={handleStopCurrentAutoRetry}
                isLoading={isLoading}
              />
            )}

            {result && result.jobId && (
              <ErrorBoundary>
                <VoiceoverUploader
                  jobId={result.jobId}
                  result={result}
                  settings={settings}
                  voiceoverScript={result.voiceoverScript}
                  aiStudioPrompt={result.aiStudioPrompt}
                  onUploadSuccess={handleVoiceoverUploadSuccess}
                  isUploading={isUploading}
                  setIsUploading={setIsUploading}
                />
              </ErrorBoundary>
            )}
          </div>

          {/* Right Column */}
          <div className="lg:col-span-6 space-y-6">
            <ErrorBoundary>
              {result ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <VideoPlayer result={result} />
                  <CaptionCard result={result} />
                </div>
              ) : (
              <div className="glass-panel rounded-2xl p-8 text-center flex flex-col items-center justify-center min-h-[480px] border-dashed border-red-500/30 bg-slate-900/60">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-red-600/30 via-rose-600/20 to-red-500/30 border border-red-500/40 flex items-center justify-center text-red-400 mb-4 shadow-xl shadow-red-950/50">
                  <Clapperboard className="w-8 h-8 stroke-[1.75]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Alur Review Spesifikasi HP: YouTube 16:9 HD + AI Scripting</h3>
                <p className="text-xs text-slate-300 max-w-md leading-relaxed mb-6 font-medium">
                  1. Masukkan Tipe Smartphone (Rp 2 Jutaan+, Android 16+), Spesifikasi, &amp; URL YouTube.<br />
                  2. <strong className="text-red-400">Gemini Direct (Flash)</strong> menganalisis footage YouTube dan memilih 12–18 klip sorotan terbaik (layar AMOLED, performa gaming, baterai, kamera depan &amp; belakang).<br />
                  3. <strong className="text-rose-400">FFmpeg</strong> memotong dan menyusun klip dalam <strong className="text-white">format 16:9 Landscape native</strong> dengan dynamic colored pillars (durasi 50–59 detik).<br />
                  4. Sistem membuat <strong className="text-emerald-400">Voiceover Reviewer Gadget Ahli &amp; Subtitle Sinkron</strong> dengan soft selling CTA link di deskripsi video.
                </p>
                <div className="grid grid-cols-2 gap-3 w-full max-w-sm text-left">
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-red-500/30 text-xs shadow-sm">
                    <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                      <Sparkles className="w-3.5 h-3.5 text-red-400" />
                      <span>Gemini Direct (Flash)</span>
                    </div>
                    <p className="text-[11px] text-slate-400">Review 5-Beat &amp; Uji Kamera (0 MB Kuota)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700 text-xs shadow-sm">
                    <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1">
                      <Clapperboard className="w-3.5 h-3.5 text-indigo-400" />
                      <span>16:9 Landscape HD</span>
                    </div>
                    <p className="text-[11px] text-slate-400">YouTube Reguler (Dynamic Pillars)</p>
                  </div>
                </div>
              </div>
            )}
            </ErrorBoundary>
          </div>

        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        engineStatus={engineStatus}
      />

      <footer className="border-t border-slate-800/60 py-4 bg-slate-950/60 text-center text-xs text-slate-400">
        <p className="font-medium">🔴 <strong className="text-slate-200">YTCLIPER Tech Review Engine</strong> &bull; YouTube 16:9 Landscape Layout &bull; Review HP Android 16+ (Rp 2 Jutaan+) &bull; Durasi 50–59s &bull; CTA Link di Deskripsi Video</p>
      </footer>
    </div>
  );
}
