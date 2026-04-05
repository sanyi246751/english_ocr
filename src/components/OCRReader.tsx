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
  usePiper: boolean;
}

export default function OCRReader() {
  const [text, setText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [practiceResult, setPracticeResult] = useState<{ score: number, recognized: string } | null>(null);

  const [config, setConfig] = useState<TTSConfig>({
    repeatCount: 1,
    interval: 1000,
    speed: 1.0,
    voiceURI: '',
    usePiper: false // Kept for type compatibility but unused
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlayingRef = useRef(false);

  // Initialize Voices with mobile robust-detect
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));
      
      if (availableVoices.length > 0) {
        setVoices(englishVoices.length > 0 ? englishVoices : availableVoices);
        
        // Auto-select Danny Teacher only if not already set
        if (englishVoices.length > 0) {
          setConfig(prev => {
            if (prev.voiceURI) return prev;
            const danny = englishVoices.find(v => (
              v.name.toLowerCase().includes('male') || 
              v.name.toLowerCase().includes('david') || 
              v.name.toLowerCase().includes('danny') || 
              v.name.toLowerCase().includes('mark') ||
              v.name.toLowerCase().includes('english (united states)-x-sfg-local')
            )) || englishVoices[0];
            return { ...prev, voiceURI: danny.voiceURI };
          });
        }
      }
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    timer = setInterval(() => {
      if (window.speechSynthesis.getVoices().length > 0) {
        loadVoices();
        clearInterval(timer);
      }
    }, 1000);

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      clearInterval(timer);
    };
  }, []);

  const getCharacterName = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    if (name.includes('female') || name.includes('susan') || name.includes('zira') || name.includes('samantha') || name.includes('linda') || name.includes('-x-sfg-local')) {
      if (name.includes('male') || name.includes('david')) return '👨‍🏫 丹尼老師'; // Exception for overlapping names
      return '👩‍🏫 露西姊姊';
    }
    if (name.includes('male') || name.includes('david') || name.includes('danny') || name.includes('mark') || name.includes('steven') || name.includes('daniel')) return '👨‍🏫 丹尼老師';
    if (name.includes('child') || name.includes('junior')) return '🧒 小朋友';
    return `✨ ${voice.name.split(' ')[0].replace(/[^a-zA-Z]/g, '') || '小語音'}`;
  };

  const evaluateWithWebSpeech = () => {
    if (!('webkitSpeechRecognition' in window) && !('speechRecognition' in window)) {
      setError('您的瀏覽器不支援語音辨識喔！建議使用 Chrome。');
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).speechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsRecognizing(true);
      setPracticeResult(null);
    };

    recognition.onresult = (event: any) => {
      const recognized = event.results[0][0].transcript;
      const originalWords = text.toLowerCase().match(/\w+/g) || [];
      const recognizedWords = recognized.toLowerCase().match(/\w+/g) || [];
      let matches = 0;
      originalWords.forEach(w => { if (recognizedWords.includes(w)) matches++; });
      const score = Math.round((matches / Math.max(originalWords.length, 1)) * 100);
      setPracticeResult({ score, recognized });
    };

    recognition.onerror = () => {
      setError('沒聽清楚，可以再讀一遍嗎？');
      setIsRecognizing(false);
    };

    recognition.onend = () => {
      setIsRecognizing(false);
    };

    recognition.start();
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
        if (!context) throw new Error('Canvas context error');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
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
      setError('照片看不清楚喔：' + (err.message || '未知錯誤'));
    } finally {
      setIsProcessing(false);
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
      setError('相機打不開喔！');
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
    <div className="min-h-screen bg-[#FFFDF7] p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="text-center space-y-2 pt-4">
          <div>
            <motion.h1 initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-orange-500 to-amber-500 tracking-tight">
              品量的英語小助手
            </motion.h1>
            <p className="text-amber-600 font-bold text-lg italic">✨ 陪你一起快樂唸英文 ✨</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white/90 backdrop-blur-md border-4 border-orange-100 rounded-[40px] p-8 shadow-2xl shadow-orange-200/50 space-y-8">
              <div className="space-y-6">
                <h2 className="text-xl font-bold flex items-center gap-4 text-orange-600">
                  放入課本
                </h2>
                <div className="flex flex-col gap-4">
                  <button onClick={startCamera} className="flex items-center justify-between p-6 rounded-[30px] bg-gradient-to-br from-orange-400 to-orange-500 text-white hover:scale-[1.03] active:scale-95 transition-all shadow-lg shadow-orange-200 group">
                    <div className="flex items-center gap-4">
                      <Camera className="w-8 h-8" />
                      <span className="text-xl font-bold">打開相機</span>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-black">→</div>
                  </button>
                  <div {...getRootProps()} className="cursor-pointer">
                    <input {...getInputProps()} />
                    <div className={cn("flex items-center justify-between p-6 rounded-[30px] border-4 border-dashed transition-all group", isDragActive ? "border-orange-400 bg-orange-50" : "border-amber-100 hover:border-orange-300 hover:bg-amber-50")}>
                      <div className="flex items-center gap-4">
                        <Upload className="w-8 h-8 text-amber-300" />
                        <span className="text-xl font-bold text-amber-700">上傳圖片</span>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-400 group-hover:bg-orange-100 italic">+</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-10 border-t-4 border-orange-50">
                <h3 className="text-lg font-black text-amber-600 flex items-center gap-4">
                  唸書小設定
                </h3>
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="text-sm font-black text-amber-500 flex px-1">誰來教我唸？</label>
                    <select value={config.voiceURI} onChange={(e) => setConfig({...config, voiceURI: e.target.value})} className="w-full p-5 rounded-[25px] bg-amber-50 border-2 border-amber-100 text-lg font-bold text-amber-800 outline-none focus:border-orange-400 transition-colors cursor-pointer">
                      {voices.length > 0 ? voices.map(v => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {getCharacterName(v)}
                        </option>
                      )) : <option>載入中...</option>}
                    </select>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-black text-amber-500 flex justify-between px-1">唸幾遍 <span>{config.repeatCount} 次</span></label>
                    <input type="range" min="1" max="5" step="1" value={config.repeatCount} onChange={(e) => setConfig({...config, repeatCount: parseInt(e.target.value)})} className="w-full h-3 bg-amber-100 rounded-full appearance-none cursor-pointer accent-orange-500" />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-amber-500 flex justify-between px-1">唸多快 <span>{config.speed}x</span></label>
                    <input type="range" min="0.5" max="2.0" step="0.1" value={config.speed} onChange={(e) => setConfig({...config, speed: parseFloat(e.target.value)})} className="w-full h-3 bg-amber-100 rounded-full appearance-none cursor-pointer accent-orange-500" />
                  </div>
                  <div className="space-y-3">
                    <label className="text-sm font-black text-amber-500 flex justify-between px-1">唸一行停一下 <span>{config.interval / 1000}秒</span></label>
                    <input type="range" min="0" max="3000" step="500" value={config.interval} onChange={(e) => setConfig({...config, interval: parseInt(e.target.value)})} className="w-full h-3 bg-amber-100 rounded-full appearance-none cursor-pointer accent-orange-500" />
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="lg:col-span-8 space-y-8">
            <section className="bg-white/90 backdrop-blur-md border-4 border-orange-50 rounded-[50px] p-10 shadow-2xl shadow-orange-200/30 flex flex-col relative overflow-hidden h-full">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black text-orange-950">
                  辨識到的內容
                </h2>
                <div className="flex items-center gap-4">
                  {text && (
                    <button onClick={copyToClipboard} className="p-4 rounded-[20px] bg-amber-50 hover:bg-amber-100 text-amber-400 transition-colors">
                      {isCopied ? <Check className="w-7 h-7 text-green-500" /> : <Copy className="w-7 h-7" />}
                    </button>
                  )}
                  <button onClick={() => { setText(''); setPracticeResult(null); }} className="p-4 rounded-[20px] bg-orange-50 hover:bg-orange-100 text-orange-300 hover:text-orange-500 transition-colors">
                    <RotateCcw className="w-7 h-7" />
                  </button>
                </div>
              </div>

              <div className="flex-1 relative group min-h-[450px]">
                {isProcessing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-white/90 backdrop-blur-md z-10 rounded-[40px]">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                      <Loader2 className="w-20 h-20 text-orange-400" />
                    </motion.div>
                    <p className="text-orange-600 text-2xl font-black text-center">小助手正在辨識中...</p>
                  </div>
                )}
                
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="✨ 把課本放進來，按一下「開始唸書」就可以聽囉！🎒"
                  className="w-full h-full p-10 rounded-[40px] bg-[#FFF9E5] border-4 border-transparent focus:border-orange-200 transition-all outline-none resize-none text-3xl font-black leading-relaxed text-[#0F172A] placeholder:text-amber-300 caret-orange-500"
                />

                {/* Practice Score Overlay */}
                <AnimatePresence>
                  {practiceResult && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="absolute bottom-8 right-8 bg-white shadow-2xl rounded-[35px] border-4 border-orange-100 p-8 z-20 flex flex-col items-center gap-4">
                      <div className="text-5xl font-black text-orange-600">{practiceResult.score} 分</div>
                      <div className="text-sm font-bold text-amber-400">你剛讀了: "{practiceResult.recognized}"</div>
                      <button onClick={() => setPracticeResult(null)} className="text-orange-400 font-bold text-sm underline">清除</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {error && (
                <div className="mt-8 p-5 rounded-[25px] bg-orange-50 text-orange-500 font-bold flex items-center gap-4">
                  <X className="w-8 h-8" />
                  {error}
                </div>
              )}

              <div className="mt-12 grid grid-cols-4 gap-6 items-center">
                <button onClick={stopTTS} disabled={!isPlaying} className="flex flex-col items-center justify-center p-6 rounded-[35px] bg-slate-50 text-slate-400 hover:bg-slate-100 disabled:opacity-20 transition-all gap-2">
                  <Pause className="w-10 h-10 fill-current" />
                  <span className="text-xs font-black">停止</span>
                </button>

                <button onClick={playTTS} disabled={!text || isProcessing || isPlaying} className={cn("col-span-2 flex flex-col items-center justify-center p-8 rounded-[40px] shadow-2xl transition-all gap-2 scale-110 z-10", isPlaying ? "bg-slate-50 text-slate-300 cursor-not-allowed" : "bg-gradient-to-br from-orange-400 to-orange-500 text-white shadow-orange-200 hover:scale-[1.15] active:scale-95")}>
                  <Play className="w-12 h-12 fill-current" />
                  <span className="text-lg font-black tracking-wider">開始唸書</span>
                </button>

                <button 
                  onClick={evaluateWithWebSpeech}
                  disabled={!text || isProcessing || isPlaying}
                  className={cn(
                    "flex flex-col items-center justify-center p-6 rounded-[35px] transition-all gap-2",
                    isRecognizing ? "bg-orange-500 text-white animate-pulse" : "bg-orange-50 text-orange-400 hover:bg-orange-100 disabled:opacity-20"
                  )}
                >
                  <Volume2 className="w-10 h-10" />
                  <span className="text-xs font-black">{isRecognizing ? "聽你讀..." : "我要讀"}</span>
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
                  <div className="w-full h-full border-2 border-dashed border-orange-400/30 rounded-[40px]" />
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

        <footer className="text-center text-amber-300 text-lg font-bold pb-16 space-y-3">
          <p>🌈 讓英語變成你的好朋友</p>
        </footer>
      </div>
    </div>
  );
}
