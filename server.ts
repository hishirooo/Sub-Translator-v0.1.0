import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

const app = express();
app.use(express.json({ limit: '20mb' }));

// Dynamically resolve API key from environment, /app/.dev.env.json, or local .env
const getApiKey = (): string => {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }

  // Check /app/.dev.env.json written by AI Studio control plane
  try {
    const devEnvPath = '/app/.dev.env.json';
    if (fs.existsSync(devEnvPath)) {
      const devEnv = JSON.parse(fs.readFileSync(devEnvPath, 'utf-8'));
      if (devEnv.GEMINI_API_KEY && typeof devEnv.GEMINI_API_KEY === 'string' && devEnv.GEMINI_API_KEY.trim()) {
        process.env.GEMINI_API_KEY = devEnv.GEMINI_API_KEY.trim();
        return devEnv.GEMINI_API_KEY.trim();
      }
    }
  } catch {
    // ignore
  }

  // Check root .env
  try {
    const localEnvPath = path.resolve(rootDir, '.env');
    if (fs.existsSync(localEnvPath)) {
      const parsed = dotenv.parse(fs.readFileSync(localEnvPath));
      if (parsed.GEMINI_API_KEY && parsed.GEMINI_API_KEY.trim()) {
        process.env.GEMINI_API_KEY = parsed.GEMINI_API_KEY.trim();
        return parsed.GEMINI_API_KEY.trim();
      }
    }
  } catch {
    // ignore
  }

  return '';
};

// Normalize deprecated or prohibited model names to current supported Gemini models
const normalizeModel = (modelName?: string): string => {
  if (!modelName) return 'gemini-3.8-flash';
  const clean = modelName.trim();
  if (clean === 'gemini-2.5-flash' || clean === 'gemini-2.0-flash' || clean === 'gemini-1.5-flash') {
    return 'gemini-3.8-flash';
  }
  if (clean === 'gemini-2.0-flash-lite' || clean === 'gemini-2.5-flash-lite' || clean === 'gemini-1.5-flash-lite') {
    return 'gemini-3.1-flash-lite';
  }
  if (clean === 'gemini-2.5-pro' || clean === 'gemini-2.0-pro' || clean === 'gemini-1.5-pro') {
    return 'gemini-3.1-pro-preview';
  }
  return clean;
};

const getGenAI = (): GoogleGenAI => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Chưa cấu hình GEMINI_API_KEY trên máy chủ AI Studio.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
};

// Health endpoint
app.get('/api/health', (req, res) => {
  const hasApiKey = Boolean(getApiKey());
  res.json({
    status: 'ok',
    hasApiKey,
    port: process.env.PORT || 3000,
    timestamp: new Date().toISOString()
  });
});

// Translation endpoint
app.post('/api/translate', async (req, res) => {
  try {
    const {
      model = 'gemini-3.8-flash',
      items = [],
      sourceLang = 'zh',
      targetLang = 'vi',
      projectNotes = '',
      terms = [],
      previousContext = [],
      nextContext = []
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Danh sách dòng cần dịch không được để trống' });
    }

    const ai = getGenAI();
    const effectiveModel = normalizeModel(model);

    const termsPrompt = terms && terms.length > 0
      ? `\nBẮT BUỘC dùng đúng các thuật ngữ và tên riêng sau:\n${terms
          .map((t: any) => `- "${t.original}" => "${t.vietnamese}" (${t.category || 'Thuật ngữ'}${t.notes ? ': ' + t.notes : ''})`)
          .join('\n')}\n`
      : '';

    const notesPrompt = projectNotes ? `\nGhi chú dự án/văn phong/xưng hô:\n${projectNotes}\n` : '';

    const prevContextPrompt = previousContext && previousContext.length > 0
      ? `\nNgữ cảnh các câu liền trước (chỉ tham khảo, KHÔNG dịch):\n${previousContext.map((c: any) => `[${c.id}] ${c.text} -> ${c.vi || ''}`).join('\n')}\n`
      : '';

    const nextContextPrompt = nextContext && nextContext.length > 0
      ? `\nNgữ cảnh các câu tiếp theo (chỉ tham khảo, KHÔNG dịch):\n${nextContext.map((c: any) => `[${c.id}] ${c.text}`).join('\n')}\n`
      : '';

    const systemInstruction = `Bạn là chuyên gia dịch phụ đề phim/video chuyên nghiệp từ tiếng ${sourceLang === 'zh' ? 'Trung' : sourceLang === 'ja' ? 'Nhật' : sourceLang === 'ko' ? 'Hàn' : 'Anh'} sang tiếng Việt.
YÊU CẦU QUAN TRỌNG:
1. Dịch tự nhiên, đúng ngữ cảnh thoại đời thường, mượt mà và chuẩn văn phong tiếng Việt.
2. Tên người Trung Quốc: BẮT BUỘC dùng âm Hán Việt chuẩn xác. Tên Nhật/Hàn: dùng phiên âm quy ước tiếng Việt hoặc tên phổ biến.
3. KHÔNG dịch và giữ nguyên vẹn 100% các ký hiệu giữ chỗ format như [[TAG_0]], [[TAG_1]], [[NL]], v.v. tại đúng vị trí tương ứng.
4. KHÔNG bao giờ bỏ sót dòng hoặc bịa thêm dòng.
5. Trả về ĐÚNG cấu trúc JSON mảng các đối tượng { "id": number | string, "vi": string }.`;

    const prompt = `Hãy dịch danh sách các câu phụ đề sau sang tiếng Việt:
${termsPrompt}${notesPrompt}${prevContextPrompt}${nextContextPrompt}
DANH SÁCH DÒNG CẦN DỊCH:
${JSON.stringify(items, null, 2)}

Yêu cầu định dạng đầu ra:
Trả về duy nhất JSON hợp lệ có dạng:
{
  "translations": [
    { "id": 1, "vi": "bản dịch tiếng Việt..." }
  ]
}`;

    const response = await ai.models.generateContent({
      model: effectiveModel,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.3
      }
    });

    const responseText = response.text || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Mô hình không trả về định dạng JSON hợp lệ.');
      }
    }

    const translations = parsed.translations || (Array.isArray(parsed) ? parsed : []);

    const usage = {
      promptTokens: response.usageMetadata?.promptTokenCount || 0,
      responseTokens: response.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: response.usageMetadata?.totalTokenCount || 0
    };

    res.json({ translations, usage });
  } catch (err: any) {
    console.error('Translation error:', err);
    const status = err.status || (err.message?.includes('429') ? 429 : 500);
    res.status(status).json({
      error: err.message || 'Lỗi khi gọi mô hình dịch',
      status
    });
  }
});

// Auto-fix endpoint (Lite model)
app.post('/api/fix', async (req, res) => {
  try {
    const {
      model = 'gemini-3.1-flash-lite',
      items = [],
      sourceLang = 'zh',
      terms = [],
      projectNotes = ''
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Danh sách dòng cần sửa không được để trống' });
    }

    const ai = getGenAI();
    const effectiveModel = normalizeModel(model);

    const termsPrompt = terms && terms.length > 0
      ? `\nBảng thuật ngữ/tên riêng:\n${terms.map((t: any) => `- ${t.original} => ${t.vietnamese}`).join('\n')}\n`
      : '';

    const systemInstruction = `Bạn là công cụ tự sửa lỗi nhẹ cho phụ đề tiếng Việt.
Nhiệm vụ: Sửa các lỗi như còn sót ký tự Trung/Nhật/Hàn (CJK), sai thuật ngữ, lỗi chính tả, sai vị trí thẻ tag [[TAG_x]] hoặc [[NL]].
Đảm bảo giữ nguyên các placeholder tag [[TAG_x]], [[NL]] và giữ nguyên ý nghĩa câu nói.
Chỉ trả về JSON hợp lệ { "fixes": [{ "id": number | string, "vi": string }] }.`;

    const prompt = `Hãy sửa các dòng phụ đề bị lỗi sau:
${termsPrompt}${projectNotes ? `Ghi chú: ${projectNotes}\n` : ''}
DỮ LIỆU CẦN SỬA:
${JSON.stringify(items, null, 2)}

Trả về JSON:
{
  "fixes": [
    { "id": 1, "vi": "câu đã được sửa hoàn chỉnh" }
  ]
}`;

    const response = await ai.models.generateContent({
      model: effectiveModel,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const responseText = response.text || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { fixes: [] };
    }

    res.json({ fixes: parsed.fixes || [] });
  } catch (err: any) {
    console.error('Fix error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Lỗi khi sửa phụ đề' });
  }
});

// AI Term Scan endpoint
app.post('/api/scan-terms', async (req, res) => {
  try {
    const {
      model = 'gemini-3.8-flash',
      textSamples = [],
      sourceLang = 'zh'
    } = req.body;

    if (!Array.isArray(textSamples) || textSamples.length === 0) {
      return res.status(400).json({ error: 'Không có nội dung để quét từ điển' });
    }

    const ai = getGenAI();
    const effectiveModel = normalizeModel(model);

    const systemInstruction = `Bạn là chuyên gia ngôn ngữ học và dịch thuật phụ đề.
Nhiệm vụ: Trích xuất các tên riêng (nhân vật, tổ chức, địa danh), thuật ngữ đặc thù, xưng hô quan trọng xuất hiện nhiều lần trong văn bản nguồn tiếng ${sourceLang === 'zh' ? 'Trung' : sourceLang === 'ja' ? 'Nhật' : sourceLang === 'ko' ? 'Hàn' : 'Anh'}.
Nếu là tiếng Trung: BẮT BUỘC phiên âm sang Hán Việt chuẩn xác cho tên người và địa danh.
Nếu là tiếng Nhật/Hàn: dùng phiên âm chuẩn tiếng Việt.
Trả về JSON danh sách các mục:
{
  "terms": [
    {
      "original": "nguyên tác",
      "vietnamese": "bản dịch tiếng Việt / Hán Việt",
      "category": "Tên người" | "Địa danh" | "Tổ chức" | "Thuật ngữ" | "Xưng hô" | "Khác",
      "notes": "mô tả ngắn / ngữ cảnh"
    }
  ]
}`;

    const prompt = `Hãy trích xuất danh sách thuật ngữ và tên riêng từ các đoạn hội thoại sau:
${textSamples.slice(0, 150).join('\n')}

Trả về JSON có cấu trúc { "terms": [...] }`;

    const response = await ai.models.generateContent({
      model: effectiveModel,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const responseText = response.text || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { terms: [] };
    }

    res.json({ terms: parsed.terms || [] });
  } catch (err: any) {
    console.error('Scan terms error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Lỗi khi quét từ điển' });
  }
});

// AI QC deep check endpoint
app.post('/api/qc-ai', async (req, res) => {
  try {
    const {
      model = 'gemini-3.1-flash-lite',
      pairs = []
    } = req.body;

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'Không có cặp câu để hậu kiểm' });
    }

    const ai = getGenAI();
    const effectiveModel = normalizeModel(model);

    const systemInstruction = `Bạn là chuyên gia kiểm định chất lượng (QC) phụ đề tiếng Việt.
Nhiệm vụ: Đối chiếu câu gốc và câu dịch tiếng Việt, phát hiện:
- Sai lệch ý nghĩa nghiêm trọng
- Thiếu sót thông tin quan trọng
- Giọng điệu bất thường hoặc dịch máy vô nghĩa
- Sót tiếng nước ngoài
Chỉ trả về các câu có lỗi hoặc nghi vấn.`;

    const prompt = `Hãy kiểm tra các cặp phụ đề sau:
${JSON.stringify(pairs, null, 2)}

Trả về JSON:
{
  "issues": [
    {
      "id": 1,
      "severity": "Nặng" | "Nhẹ" | "Cảnh báo",
      "message": "mô tả lỗi ngắn gọn",
      "suggestion": "gợi ý sửa nếu có"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: effectiveModel,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });

    const responseText = response.text || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { issues: [] };
    }

    res.json({ issues: parsed.issues || [] });
  } catch (err: any) {
    console.error('QC error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Lỗi khi hậu kiểm AI' });
  }
});

// Parse port from CLI arguments or environment
const getPort = (): number => {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const p = parseInt(process.argv[portArgIndex + 1], 10);
    if (!isNaN(p)) return p;
  }
  return Number(process.env.PORT) || 3000;
};

// Setup dev server with Vite middleware mode or static production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production' && !process.argv.includes('server.ts') && fs.existsSync(path.resolve(rootDir, 'dist'));
  const PORT = getPort();

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
      root: rootDir
    });

    app.use(vite.middlewares);

    app.use(async (req, res, next) => {
      if (req.method !== 'GET') return next();
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(rootDir, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(rootDir, 'dist')));
    app.use((req, res) => {
      res.sendFile(path.resolve(rootDir, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
    console.log(`  [Sub Translator] Server ready on port ${PORT} (${isProduction ? 'production' : 'development mode'})\n`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
