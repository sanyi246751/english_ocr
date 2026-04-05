import React, { useState, useRef, useEffect } from 'react';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import {
  Camera,
  Upload,
  FileText,
  Play,
  Pause,
  RotateCcw,
  Settings2,
  Loader2,
  Volume2,
  Copy,
  Check,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { cn } from '@/src/lib/utils';


// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;


interface TTSConfig {
  repeatCount: number;
  interval: number;
  speed: number;
  voiceURI: string;
}

export default function OCRReader() {
  const [text, setText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [config, setConfig] = useState<TTSConfig>({
    repeatCount: 1,
    interval: 1000,
    speed: 1.0,
    voiceURI: ''
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlayingRef = useRef(false);

  // Initialize Voices
  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      // Sort voices to put Google/Online voices first for better quality consistency
      const sortedVoices = [...availableVoices].sort((a, b) => {
        const aIsGood = a.name.includes('Google') || a.name.includes('Natural') || a.name.includes('Online');
        const bIsGood = b.name.includes('Google') || b.name.includes('Natural') || b.name.includes('Online');
        if (aIsGood && !bIsGood) return -1;
        if (!aIsGood && bIsGood) return 1;
        return a.lang.localeCompare(b.lang);
      });

      // Filter for English primarily
      const englishVoices = sortedVoices.filter(v => v.lang.startsWith('en'));
      const finalVoices = englishVoices.length > 0 ? englishVoices : sortedVoices;
      
      setVoices(finalVoices);
      
      if (finalVoices.length > 0 && !config.voiceURI) {
        // Try to find a natural English voice as default
        const defaultVoice = finalVoices.find(v => v.lang === 'en-US' && (v.name.includes('Google') || v.name.includes('Natural'))) || finalVoices[0];
        setConfig(prev => ({ ...prev, voiceURI: defaultVoice.voiceURI }));
      }
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, []);

  const performOCR = async (file: File | string) => {
    setIsProcessing(true);
    setOcrProgress(0);
    setError(null);
    try {
      let imageToProcess: string | HTMLCanvasElement;

      if (file instanceof File && file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context!, viewport }).promise;
        imageToProcess = canvas;
      } else {
        imageToProcess = typeof file === 'string' ? file : await (async () => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file as File);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
        })() as string;
      }

      const { data: { text: extractedText } } = await Tesseract.recognize(
        imageToProcess,
        'eng',
        { logger: m => m.status === 'recognizing text' && setOcrProgress(m.progress) }
      );
      setText(extractedText.trim());
    } catch (err: any) {
      setError('文字辨識失敗：' + (err.message || '未知錯誤'));
    } finally {
      setIsProcessing(false);
    }
  };

  const playTTS = async () => {
    if (!text || isPlaying) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const synth = window.speechSynthesis;
    
    try {
      for (let r = 0; r < config.repeatCount; r++) {
        for (let i = 0; i < lines.length; i++) {
          if (!isPlayingRef.current) break;
          const utterance = new SpeechSynthesisUtterance(lines[i].trim());
          const selectedVoice = voices.find(v => v.voiceURI === config.voiceURI);
          if (selectedVoice) utterance.voice = selectedVoice;
          utterance.rate = config.speed;
          utterance.lang = 'en-US';

          await new Promise((resolve) => {
            utterance.onend = resolve;
            utterance.onerror = () => resolve(null);
            synth.speak(utterance);
          });

          if (i < lines.length - 1 || r < config.repeatCount - 1) {
            if (!isPlayingRef.current) break;
            await new Promise(resolve => setTimeout(resolve, config.interval));
          }
        }
        if (!isPlayingRef.current) break;
      }
    } finally {
      setIsPlaying(false);
      isPlayingRef.current = false;
    }
  };

  const stopTTS = () => {
    isPlayingRef.current = false;
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setError('無法開啟相機。');
      setShowCamera(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        performOCR(canvasRef.current.toDataURL('image/jpeg'));
        stopCamera();
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => files.length > 0 && performOCR(files[0]),
    accept: { 'image/*': ['.jpeg', '.jpg', '.png'], 'application/pdf': ['.pdf'] },
    multiple: false
  } as any);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] p-4 md:p-8 font-sans text-slate-700">
      <div className="max-w-5xl mx-auto space-y-12">
        <header className="text-center space-y-6 pt-4">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="inline-block p-5 bg-indigo-50 rounded-full">
            <Volume2 className="w-14 h-14 text-indigo-400" />
          </motion.div>
          <div>
            <motion.h1 initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-4xl md:text-5xl font-extrabold text-indigo-950 tracking-tight">
              品量的英語小助手
            </motion.h1>
            <p className="text-indigo-400 font-bold mt-2 text-lg italic">✨ 陪你一起快樂唸英文 ✨</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4 space-y-8">
            <section className="bg-white/80 backdrop-blur-md border border-indigo-50 rounded-[45px] p-8 shadow-xl shadow-indigo-100/50 space-y-8">
              <div className="space-y-6">
                <h2 className="text-xl font-black flex items-center gap-4 text-indigo-900">
                  <span className="p-3 bg-indigo-50 rounded-[22px]"><Upload className="w-6 h-6 text-indigo-500" /></span>
                  放入課本
                </h2>
                <div className="flex flex-col gap-5">
                  <button onClick={startCamera} className="flex items-center justify-between p-6 rounded-[30px] bg-indigo-500 text-white hover:bg-indigo-600 hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-indigo-200 group">
                    <div className="flex items-center gap-5">
                      <Camera className="w-8 h-8" />
                      <span className="text-xl font-bold">打開相機</span>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-black">→</div>
                  </button>
                  <div {...getRootProps()} className="cursor-pointer">
                    <input {...getInputProps()} />
                    <div className={cn("flex items-center justify-between p-6 rounded-[30px] border-4 border-dashed transition-all group", isDragActive ? "border-indigo-400 bg-indigo-50" : "border-slate-100 hover:border-indigo-200 hover:bg-slate-50")}>
                      <div className="flex items-center gap-5">
                        <Upload className="w-8 h-8 text-slate-300" />
                        <span className="text-xl font-bold text-slate-500">上傳圖片</span>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-indigo-100 italic">+</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-10 border-t border-slate-50">
                <h3 className="text-lg font-black text-slate-700 flex items-center gap-4">
                  <span className="p-3 bg-rose-50 rounded-[22px]"><Settings2 className="w-6 h-6 text-rose-400" /></span>
                  唸書小設定
                </h3>
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 flex justify-between px-1">唸幾遍 <span>{config.repeatCount} 次</span></label>
                    <input type="range" min="1" max="5" step="1" value={config.repeatCount} onChange={(e) => setConfig({...config, repeatCount: parseInt(e.target.value)})} className="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-500" />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 flex justify-between px-1">唸多快 <span>{config.speed}x</span></label>
                    <input type="range" min="0.5" max="2.0" step="0.1" value={config.speed} onChange={(e) => setConfig({...config, speed: parseFloat(e.target.value)})} className="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-500" />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 flex justify-between px-1">唸完一行停一下 <span>{config.interval / 1000}秒</span></label>
                    <input type="range" min="0" max="3000" step="500" value={config.interval} onChange={(e) => setConfig({...config, interval: parseInt(e.target.value)})} className="w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-500" />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-slate-400 flex px-1">誰來教你唸？</label>
                    <select value={config.voiceURI} onChange={(e) => setConfig({...config, voiceURI: e.target.value})} className="w-full p-5 rounded-[25px] bg-slate-50 border border-slate-100 text-lg font-bold text-slate-700 outline-none focus:border-indigo-400 transition-colors cursor-pointer">
                      {voices.length > 0 ? voices.map(v => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name.includes('Google') || v.name.includes('Online') ? '☁️ ' : '💻 '}{v.name.split(' - ')[0].replace('Microsoft ', '').replace('Google ', '')}
                        </option>
                      )) : <option>預設小語音</option>}
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-8 space-y-8">
            <section className="bg-white/90 backdrop-blur-md border border-indigo-50 rounded-[50px] p-10 shadow-2xl shadow-indigo-100/30 flex flex-col relative overflow-hidden h-full">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black flex items-center gap-4 text-indigo-950">
                  <span className="p-3 bg-indigo-50 rounded-[22px]"><FileText className="w-7 h-7 text-indigo-500" /></span>
                  辨識到的內容
                </h2>
                <div className="flex items-center gap-4">
                  {text && (
                    <button onClick={copyToClipboard} className="p-4 rounded-[20px] bg-slate-50 hover:bg-slate-100 text-slate-400 transition-colors">
                      {isCopied ? <Check className="w-7 h-7 text-green-500" /> : <Copy className="w-7 h-7" />}
                    </button>
                  )}
                  <button onClick={() => setText('')} className="p-4 rounded-[20px] bg-rose-50 hover:bg-rose-100 text-rose-300 hover:text-rose-500 transition-colors">
                    <RotateCcw className="w-7 h-7" />
                  </button>
                </div>
              </div>

              <div className="flex-1 relative group min-h-[450px]">
                {isProcessing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-white/90 backdrop-blur-md z-10 rounded-[40px]">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                      <Loader2 className="w-20 h-20 text-indigo-400" />
                    </motion.div>
                    <div className="text-center space-y-4">
                      <p className="text-indigo-600 text-2xl font-black">正在幫你讀書...</p>
                      <div className="w-72 h-4 bg-indigo-50 rounded-full overflow-hidden">
                        <motion.div className="h-full bg-gradient-to-r from-indigo-400 to-rose-300" initial={{ width: 0 }} animate={{ width: `${ocrProgress * 100}%` }} />
                      </div>
                      <p className="text-indigo-300 font-bold text-lg">{Math.round(ocrProgress * 100)}%</p>
                    </div>
                  </div>
                )}
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="✨ 把課本放進來，按一下「開始唸書」就可以聽囉！🎒"
                  className="w-full h-full p-10 rounded-[40px] bg-slate-50/50 border-2 border-transparent focus:border-indigo-100 focus:bg-white transition-all outline-none resize-none text-3xl font-medium leading-relaxed placeholder:text-slate-200"
                />
              </div>

              {error && (
                <div className="mt-8 p-5 rounded-[25px] bg-rose-50 text-rose-500 font-bold flex items-center gap-4">
                  <X className="w-8 h-8" />
                  {error}
                </div>
              )}

              <div className="mt-12 grid grid-cols-3 gap-6">
                <button onClick={stopTTS} disabled={!isPlaying} className="flex flex-col items-center justify-center p-6 rounded-[35px] bg-slate-50 text-slate-400 hover:bg-slate-100 disabled:opacity-20 transition-all gap-2">
                  <Pause className="w-10 h-10 fill-current" />
                  <span className="text-sm font-black">不用唸了</span>
                </button>
                <button onClick={playTTS} disabled={!text || isProcessing || isPlaying} className={cn("flex flex-col items-center justify-center p-8 rounded-[40px] shadow-2xl transition-all gap-2 scale-110 z-10", isPlaying ? "bg-slate-50 text-slate-300 cursor-not-allowed" : "bg-indigo-500 text-white shadow-indigo-200 hover:scale-[1.15] active:scale-95")}>
                  <Play className="w-12 h-12 fill-current" />
                  <span className="text-lg font-black tracking-wider">開始唸書</span>
                </button>
                <button onClick={() => { stopTTS(); setTimeout(playTTS, 100); }} disabled={!text || isProcessing} className="flex flex-col items-center justify-center p-6 rounded-[35px] bg-indigo-50 text-indigo-400 hover:bg-indigo-100 disabled:opacity-20 transition-all gap-2">
                  <RotateCcw className="w-10 h-10" />
                  <span className="text-sm font-black">再唸一次</span>
                </button>
              </div>
            </section>
          </div>
        </div>

        <AnimatePresence>
          {showCamera && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/98 p-4 backdrop-blur-xl">
              <div className="relative w-full max-w-5xl h-[85vh] rounded-[50px] overflow-hidden bg-black border border-white/10 shadow-2xl">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
                  <div className="w-full h-full border-2 border-dashed border-indigo-400/30 rounded-[40px]" />
                </div>
                <div className="absolute bottom-12 left-0 right-0 flex items-center justify-center gap-16">
                  <button onClick={stopCamera} className="p-6 rounded-full bg-slate-800 text-white hover:bg-slate-700 transition-colors">
                    <X className="w-10 h-10" />
                  </button>
                  <button onClick={capturePhoto} className="w-28 h-28 rounded-full border-[10px] border-white/30 flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all scale-110 active:scale-90">
                    <div className="w-20 h-20 rounded-full bg-white shadow-2xl" />
                  </button>
                  <div className="w-22" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="text-center text-slate-300 text-lg font-bold pb-16 space-y-3">
          <p>🌈 讓英語變成你的好朋友</p>
          <div className="flex justify-center gap-6 text-xs font-medium opacity-30">
            <span>Powered by Open-Source Libraries</span>
            <span>Made with Care for Kids</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
