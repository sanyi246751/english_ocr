import React, { useState, useRef } from 'react';
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
import { GoogleGenAI, Modality } from "@google/genai";

// Configure PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// Keep Gemini for TTS only (or other high-quality tasks)
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface TTSConfig {
  repeatCount: number;
  interval: number;
  speed: number;
  voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
}

export default function OCRReader() {
  const [text, setText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [config, setConfig] = useState<TTSConfig>({
    repeatCount: 1,
    interval: 1000,
    speed: 1.0,
    voice: 'Kore'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);

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
        // PDF.js processing
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1); // Process first page
        
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({ canvasContext: context!, viewport }).promise;
        imageToProcess = canvas;
      } else {
        // Image or Camera processing
        imageToProcess = typeof file === 'string' ? file : await fileToBase64(file);
      }

      // Tesseract.js recognition
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

  // TTS Function (Remains the same as high-quality Gemini TTS is requested)
  const playTTS = async () => {
    if (!text || isPlaying) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    setError(null);

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    try {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      
      for (let r = 0; r < config.repeatCount; r++) {
        for (let i = 0; i < sentences.length; i++) {
          if (!isPlayingRef.current) break;

          const sentence = sentences[i].trim();
          const response = await genAI.models.generateContent({
            model: "gemini-2.0-flash-exp-tts" as any, // Fixed model name to a more common one if available
            contents: [{ parts: [{ text: `Read this clearly: ${sentence}` }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: config.voice },
                },
              },
            },
          } as any);

          const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio && isPlayingRef.current) {
            const binary = atob(base64Audio);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) {
              bytes[j] = binary.charCodeAt(j);
            }
            
            const int16Data = new Int16Array(bytes.buffer);
            const float32Data = new Float32Array(int16Data.length);
            for (let j = 0; j < int16Data.length; j++) {
              float32Data[j] = int16Data[j] / 32768.0;
            }

            const audioBuffer = audioCtx.createBuffer(1, float32Data.length, 24000);
            audioBuffer.getChannelData(0).set(float32Data);
            
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = config.speed;
            source.connect(audioCtx.destination);
            
            await new Promise((resolve) => {
              source.onended = resolve;
              source.start();
              const checkInterval = setInterval(() => {
                if (!isPlayingRef.current) {
                  source.stop();
                  clearInterval(checkInterval);
                  resolve(null);
                }
              }, 100);
              source.addEventListener('ended', () => clearInterval(checkInterval));
            });
          }

          if (i < sentences.length - 1 || r < config.repeatCount - 1) {
            if (!isPlayingRef.current) break;
            await new Promise(resolve => setTimeout(resolve, config.interval));
          }
        }
        if (!isPlayingRef.current) break;
      }
    } catch (err: any) {
      console.error('TTS Error:', err);
      setError('語音合成失敗：' + (err.message || '請確認 API Key 是否正確'));
    } finally {
      setIsPlaying(false);
      isPlayingRef.current = false;
      audioCtx.close();
    }
  };

  const stopTTS = () => {
    isPlayingRef.current = false;
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
    <div className="min-h-screen bg-[#f0f4f8] p-4 md:p-8 font-sans text-slate-800">
      <audio ref={audioRef} hidden />
      
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header className="text-center space-y-2">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600"
          >
            品量的英語小助手
          </motion.h1>
          <p className="text-slate-500">English OCR & Reader</p>
        </header>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Controls & Input */}
          <div className="lg:col-span-1 space-y-6">
            <section className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-xl shadow-blue-500/5 space-y-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-500" />
                來源輸入
              </h2>
              
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={startCamera}
                  className="flex flex-col items-center justify-center p-4 rounded-2xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors gap-2 group"
                >
                  <Camera className="w-6 h-6 group-hover:scale-110 transition-transform" />
                  <span className="text-sm font-medium">相機拍照</span>
                </button>
                
                <div {...getRootProps()} className="cursor-pointer">
                  <input {...getInputProps()} />
                  <div className={cn(
                    "flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed transition-all gap-2 h-full",
                    isDragActive ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-blue-300 hover:bg-slate-50"
                  )}>
                    <Upload className="w-6 h-6 text-slate-400" />
                    <span className="text-sm font-medium text-slate-600">上傳檔案</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h3 className="text-sm font-semibold text-slate-500 flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  朗讀設定
                </h3>
                
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400 flex justify-between">
                      重複次數 <span>{config.repeatCount} 次</span>
                    </label>
                    <input 
                      type="range" min="1" max="5" step="1"
                      value={config.repeatCount}
                      onChange={(e) => setConfig({...config, repeatCount: parseInt(e.target.value)})}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400 flex justify-between">
                      語速 <span>{config.speed}x</span>
                    </label>
                    <input 
                      type="range" min="0.5" max="2.0" step="0.1"
                      value={config.speed}
                      onChange={(e) => setConfig({...config, speed: parseFloat(e.target.value)})}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400 flex justify-between">
                      間隔時間 <span>{config.interval / 1000}s</span>
                    </label>
                    <input 
                      type="range" min="0" max="3000" step="500"
                      value={config.interval}
                      onChange={(e) => setConfig({...config, interval: parseInt(e.target.value)})}
                      className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">語音角色</label>
                    <select 
                      value={config.voice}
                      onChange={(e) => setConfig({...config, voice: e.target.value as any})}
                      className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:border-blue-400 transition-colors"
                    >
                      <option value="Kore">Kore (溫和)</option>
                      <option value="Puck">Puck (活潑)</option>
                      <option value="Charon">Charon (沉穩)</option>
                      <option value="Fenrir">Fenrir (低沉)</option>
                      <option value="Zephyr">Zephyr (清亮)</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Result Display */}
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-white/70 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-xl shadow-blue-500/5 min-h-[400px] flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-500" />
                  辨識結果
                </h2>
                <div className="flex items-center gap-2">
                  {text && (
                    <button 
                      onClick={copyToClipboard}
                      className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors relative"
                    >
                      {isCopied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                    </button>
                  )}
                  <button 
                    onClick={() => setText('')}
                    className="p-2 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 relative">
                {isProcessing ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/50 backdrop-blur-sm z-10">
                    <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                    <p className="text-slate-500 font-medium animate-pulse">
                      正在辨識文字中... {Math.round(ocrProgress * 100)}%
                    </p>
                    <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-blue-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${ocrProgress * 100}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="辨識後的文字會出現在這裡，或是手動輸入文字進行朗讀..."
                  className="w-full h-full min-h-[300px] p-4 rounded-2xl bg-slate-50/50 border border-slate-100 focus:border-blue-300 focus:ring-0 outline-none resize-none text-lg leading-relaxed placeholder:text-slate-300"
                />
              </div>

              {error && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm flex items-center gap-2">
                  <X className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="mt-6 flex gap-4">
                <button 
                  onClick={isPlaying ? stopTTS : playTTS}
                  disabled={!text || isProcessing}
                  className={cn(
                    "flex-1 py-4 rounded-2xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
                    isPlaying 
                      ? "bg-red-500 hover:bg-red-600 shadow-red-500/20" 
                      : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:scale-[1.02] active:scale-95 shadow-blue-600/20"
                  )}
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-6 h-6 fill-current" />
                      停止朗讀
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-6 h-6" />
                      開始朗讀
                    </>
                  )}
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
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
            >
              <div className="relative w-full max-w-2xl aspect-video rounded-3xl overflow-hidden bg-slate-900 shadow-2xl">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />
                
                <div className="absolute inset-0 border-2 border-white/20 pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-blue-500/50 rounded-3xl" />
                </div>

                <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-8">
                  <button 
                    onClick={stopCamera}
                    className="p-4 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <button 
                    onClick={capturePhoto}
                    className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center group"
                  >
                    <div className="w-16 h-16 rounded-full bg-white group-active:scale-90 transition-transform" />
                  </button>
                  <div className="w-14" /> {/* Spacer */}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="text-center text-slate-400 text-sm pb-8">
          <p>© 2026 品量的英語小助手. Powered by Tesseract.js, PDF.js & Gemini AI.</p>
        </footer>
      </div>
    </div>
  );
}
