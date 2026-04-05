import { pipeline, env } from '@xenova/transformers';

// Configure environment
env.allowLocalModels = false;
env.useBrowserCache = true;

let ttsPipeline = null;
let asrPipeline = null;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  try {
    if (type === 'init-tts') {
      if (!ttsPipeline) {
        self.postMessage({ type: 'status', payload: '正在載入 Piper 語音模型 (約 60MB)...' });
        ttsPipeline = await pipeline('text-to-speech', 'Xenova/distil-speech-en-medium-piper', {
          device: 'wasm',
        });
        self.postMessage({ type: 'status', payload: 'Piper 語音載入完成！' });
      }
      self.postMessage({ type: 'init-complete', payload: 'tts' });
    }

    if (type === 'init-asr') {
      if (!asrPipeline) {
        self.postMessage({ type: 'status', payload: '正在載入 Whisper 評分模型 (約 40MB)...' });
        asrPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
          device: 'wasm',
        });
        self.postMessage({ type: 'status', payload: 'Whisper 模型載入完成！' });
      }
      self.postMessage({ type: 'init-complete', payload: 'asr' });
    }

    if (type === 'generate-tts') {
      if (!ttsPipeline) throw new Error('TTS Model not initialized');
      const output = await ttsPipeline(payload.text);
      self.postMessage({ type: 'tts-result', payload: { audio: output.audio, sampling_rate: output.sampling_rate } });
    }

    if (type === 'transcribe') {
      if (!asrPipeline) throw new Error('ASR Model not initialized');
      const output = await asrPipeline(payload.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({ type: 'asr-result', payload: output.text });
    }
  } catch (err) {
    self.postMessage({ type: 'error', payload: err.message });
  }
};
