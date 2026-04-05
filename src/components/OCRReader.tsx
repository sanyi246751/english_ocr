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
  X,
  FileSearch
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
      // Filter for English voices (or all if preferred, but user requested English app)
      const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));
      setVoices(englishVoices.length > 0 ? englishVoices : availableVoices);
      
      if (englishVoices.length > 0 && !config.voiceURI) {
        setConfig(prev => ({ ...prev, voiceURI: englishVoices[0].voiceURI }));
      }
    };
    
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, []);

  // Helper: File to Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Improved OCR Function (Tesseract + PDF.js)
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
        // Tesseract.js handles both Base64 (from Camera) and Image files
        imageToProcess = typeof file === 'string' ? file : await fileToBase64(file);
      }

      const { data: { text: extractedText } } = await Tesseract.recognize(
        imageToProcess,
        'eng',
        { 
          logger: m => {
            if (m.status === 'recognizing text') {
              setOcrProgress(m.progress);
            }
          }
        }
      );

      setText(extractedText.trim());
    } catch (err: any) {
      console.error('OCR Error:', err);
      setError('文字辨識失敗：' + (err.message || '未知錯誤'));
    } finally {
      setIsProcessing(false);
      setOcrProgress(0);
    }
  };

  // Open Source TTS (Web Speech API) - Line-based interval
  const playTTS = async () => {
    if (!text || isPlaying) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    setError(null);

    try {
      // Split by NEWLINE as requested by the user
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      const synth = window.speechSynthesis;
      
      for (let r = 0; r < config.repeatCount; r++) {
        for (let i = 0; i < lines.length; i++) {
          if (!isPlayingRef.current) break;

          const lineContent = lines[i].trim();
          const utterance = new SpeechSynthesisUtterance(lineContent);
          
          const selectedVoice = voices.find(v => v.voiceURI === config.voiceURI);
          if (selectedVoice) utterance.voice = selectedVoice;
          utterance.rate = config.speed;
          utterance.lang = 'en-US';

          await new Promise((resolve) => {
            utterance.onend = resolve;
            utterance.onerror = () => resolve(null);
            synth.speak(utterance);
          });

          // Wait the specified interval between lines
          if (i < lines.length - 1 || r < config.repeatCount - 1) {
            if (!isPlayingRef.current) break;
            await new Promise(resolve => setTimeout(resolve, config.interval));
          }
        }
        if (!isPlayingRef.current) break;
      }
    } catch (err: any) {
      console.error('TTS Error:', err);
      setError('語音合成失敗：' + (err.message || '瀏覽器不支援 Speech API'));
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera Error:', err);
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
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        performOCR(dataUrl);
        stopCamera();
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      performOCR(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png'],
      'application/pdf': ['.pdf']
    },
    multiple: false
  } as any);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#FFFBEB] p-4 md:p-8 font-sans text-slate-800">
      
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <header className="text-center space-y-4">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 100 }}
            className="inline-block p-4 bg-orange-100 rounded-full"
          >
            <Volume2 className="w-12 h-12 text-orange-500" />
          </motion.div>
          <div>
            <motion.h1 
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-orange-500 to-amber-500 tracking-tight"
            >
              品量的英語小助手
            </motion.h1>
            <p className="text-amber-600 font-medium mt-1">✨ 英語讀讀看，學習好簡單 ✨</p>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Column: Controls & Input */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white/90 backdrop-blur-md border-4 border-orange-100 rounded-[40px] p-8 shadow-2xl shadow-orange-200/50 space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-bold flex items-center gap-3 text-orange-600">
                  <span className="p-2 bg-orange-100 rounded-2xl"><Upload className="w-6 h-6" /></span>
                  放進教材
                </h2>
                
                <div className="flex flex-col gap-4">
                  <button 
                    onClick={startCamera}
                    className="flex items-center justify-between p-5 rounded-3xl bg-gradient-to-br from-orange-400 to-orange-500 text-white hover:scale-[1.03] active:scale-95 transition-all shadow-lg shadow-orange-200 group"
                  >
                    <div className="flex items-center gap-4">
                      <Camera className="w-8 h-8" />
                      <span className="text-lg font-bold">打開相機</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">→</div>
                  </button>
                  
                  <div {...getRootProps()} className="cursor-pointer">
                    <input {...getInputProps()} />
                    <div className={cn(
                      "flex items-center justify-between p-5 rounded-3xl border-4 border-dashed transition-all group",
                      isDragActive ? "border-orange-400 bg-orange-50" : "border-amber-100 hover:border-orange-300 hover:bg-amber-50"
                    )}>
                      <div className="flex items-center gap-4">
                        <Upload className="w-8 h-8 text-amber-400" />
                        <span className="text-lg font-bold text-amber-700">上傳檔案</span>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center group-hover:bg-orange-100 italic">+</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 pt-8 border-t-4 border-orange-50">
                <h3 className="text-lg font-bold text-amber-600 flex items-center gap-3">
                  <span className="p-2 bg-amber-100 rounded-2xl"><Settings2 className="w-5 h-5" /></span>
                  朗讀設定
                </h3>
                
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-amber-500 flex justify-between px-1">
                      重複唸幾次 <span>{config.repeatCount} 次</span>
                    </label>
                    <input 
                      type="range" min="1" max="5" step="1"
                      value={config.repeatCount}
                      onChange={(e) => setConfig({...config, repeatCount: parseInt(e.target.value)})}
                      className="w-full h-3 bg-amber-100 rounded-full appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-amber-500 flex justify-between px-1">
                      唸書速度 <span>{config.speed}x</span>
                    </label>
                    <input 
                      type="range" min="0.5" max="2.0" step="0.1"
                      value={config.speed}
                      onChange={(e) => setConfig({...config, speed: parseFloat(e.target.value)})}
                      className="w-full h-3 bg-amber-100 rounded-full appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-amber-500 flex justify-between px-1">
                      每行停頓 <span>{config.interval / 1000}秒</span>
                    </label>
                    <input 
                      type="range" min="0" max="3000" step="500"
                      value={config.interval}
                      onChange={(e) => setConfig({...config, interval: parseInt(e.target.value)})}
                      className="w-full h-3 bg-amber-100 rounded-full appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-amber-500 flex px-1 italic">誰來唸給我聽</label>
                    <select 
                      value={config.voiceURI}
                      onChange={(e) => setConfig({...config, voiceURI: e.target.value})}
                      className="w-full p-4 rounded-[20px] bg-amber-50 border-2 border-amber-100 text-base font-bold text-amber-900 outline-none focus:border-orange-400 transition-colors cursor-pointer"
                    >
                      {voices.length > 0 ? (
                        voices.map(v => (
                          <option key={v.voiceURI} value={v.voiceURI}>
                            {v.name.includes('Google') ? '🎨 ' : '👤 '}{v.name.split(' - ')[0]}
                          </option>
                        ))
                      ) : (
                        <option>預設小老師</option>
                      )}
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Result Display */}
          <div className="lg:col-span-8 space-y-6">
            <section className="bg-white/90 backdrop-blur-md border-4 border-amber-100 rounded-[40px] p-8 shadow-2xl shadow-orange-200/30 flex flex-col relative overflow-hidden h-full">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold flex items-center gap-3 text-amber-700">
                  <span className="p-2 bg-amber-100 rounded-2xl"><FileText className="w-6 h-6" /></span>
                  書本內容
                </h2>
                <div className="flex items-center gap-3">
                  {text && (
                    <button 
                      onClick={copyToClipboard}
                      className="p-3 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors"
                      title="複製文字"
                    >
                      {isCopied ? <Check className="w-6 h-6 text-green-500" /> : <Copy className="w-6 h-6" />}
                    </button>
                  )}
                  <button 
                    onClick={() => setText('')}
                    className="p-3 rounded-2xl bg-orange-50 hover:bg-orange-100 text-orange-400 hover:text-orange-600 transition-colors"
                    title="重新開始"
                  >
                    <RotateCcw className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <div className="flex-1 relative group min-h-[400px]">
                {isProcessing ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-white/80 backdrop-blur-md z-10 rounded-[30px]">
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    >
                      <Loader2 className="w-16 h-16 text-orange-500" />
                    </motion.div>
                    <div className="text-center space-y-3">
                      <p className="text-orange-600 text-xl font-black animate-bounce">正在努力讀書中...</p>
                      <div className="w-64 h-3 bg-orange-100 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-gradient-to-r from-orange-400 to-amber-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${ocrProgress * 100}%` }}
                        />
                      </div>
                      <p className="text-orange-400 font-bold">{Math.round(ocrProgress * 100)}%</p>
                    </div>
                  </div>
                ) : null}

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="請拍一張英文課本的照片，或是把檔案傳上來喔！🎒"
                  className="w-full h-full p-8 rounded-[30px] bg-amber-50/30 border-2 border-amber-50 focus:border-orange-300 focus:bg-white transition-all outline-none resize-none text-2xl leading-relaxed font-medium placeholder:text-amber-200"
                />
              </div>

              {error && (
                <div className="mt-6 p-4 rounded-3xl bg-red-50 text-red-600 font-bold flex items-center gap-3">
                  <X className="w-6 h-6" />
                  {error}
                </div>
              )}

              {/* Playback Controls */}
              <div className="mt-8 grid grid-cols-3 gap-4">
                <button 
                  onClick={stopTTS}
                  disabled={!isPlaying}
                  className="flex flex-col items-center justify-center p-4 rounded-[25px] bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-30 transition-all gap-1"
                >
                  <Pause className="w-8 h-8 fill-current" />
                  <span className="text-xs font-black">停止</span>
                </button>
                
                <button 
                  onClick={playTTS}
                  disabled={!text || isProcessing || isPlaying}
                  className={cn(
                    "flex flex-col items-center justify-center p-6 rounded-[30px] shadow-xl transition-all gap-1 scale-110 z-10",
                    isPlaying 
                      ? "bg-amber-100 text-amber-400 cursor-not-allowed" 
                      : "bg-gradient-to-br from-green-400 to-emerald-500 text-white shadow-emerald-200 hover:scale-[1.15] active:scale-95"
                  )}
                >
                  <Play className="w-10 h-10 fill-current" />
                  <span className="text-sm font-black">開始播放</span>
                </button>

                <button 
                  onClick={() => { stopTTS(); setTimeout(playTTS, 100); }}
                  disabled={!text || isProcessing}
                  className="flex flex-col items-center justify-center p-4 rounded-[25px] bg-blue-100 text-blue-600 hover:bg-blue-200 disabled:opacity-30 transition-all gap-1"
                >
                  <RotateCcw className="w-8 h-8" />
                  <span className="text-xs font-black">重新朗讀</span>
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Camera Modal */}
        <AnimatePresence>
          {showCamera && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-md"
            >
              <div className="relative w-full max-w-3xl aspect-[3/4] md:aspect-video rounded-[40px] overflow-hidden bg-slate-900 border-4 border-white/20 shadow-2xl">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                
                <div className="absolute inset-0 border-8 border-orange-500/30 pointer-events-none rounded-[36px]">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[60%] border-4 border-dashed border-white/50 rounded-3xl" />
                </div>

                <div className="absolute bottom-10 left-0 right-0 flex items-center justify-center gap-12">
                  <button 
                    onClick={stopCamera}
                    className="p-5 rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition-colors"
                  >
                    <X className="w-8 h-8" />
                  </button>
                  <button 
                    onClick={capturePhoto}
                    className="w-24 h-24 rounded-full border-8 border-white flex items-center justify-center bg-white/20 hover:bg-white/40 transition-all scale-110 active:scale-90"
                  >
                    <div className="w-16 h-16 rounded-full bg-white shadow-xl" />
                  </button>
                  <div className="w-18" /> {/* Spacer */}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="text-center text-amber-300 text-base font-bold pb-12 space-y-2">
          <p>🌈 跟著小助手一起快樂學英語吧！</p>
          <div className="flex justify-center gap-4 text-xs opacity-50">
            <span>📚 Tesseract.js</span>
            <span>📄 PDF.js</span>
            <span>🎯 Web Speech API</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
