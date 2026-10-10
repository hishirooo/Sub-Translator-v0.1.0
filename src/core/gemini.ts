import { DictionaryTerm } from '../types';

export interface HealthResponse {
  status: string;
  hasApiKey: boolean;
  port?: number | string;
  timestamp: string;
}

export interface TranslateApiRequest {
  model: string;
  items: { id: number; text: string }[];
  sourceLang: string;
  targetLang: string;
  projectNotes?: string;
  terms?: DictionaryTerm[];
  previousContext?: { id: number; text: string; vi?: string }[];
  nextContext?: { id: number; text: string }[];
}

export interface TranslateApiResponse {
  translations: { id: number | string; vi: string }[];
  usage?: {
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
  };
}

export class GeminiApiClient {
  private static async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      let errorMsg = `Lỗi mạng HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errorMsg = errJson.error || errorMsg;
      } catch {
        // ignore parse error
      }
      const error: any = new Error(errorMsg);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  public static async checkHealth(): Promise<HealthResponse> {
    try {
      const res = await fetch('/api/health');
      return await this.handleResponse<HealthResponse>(res);
    } catch (err: any) {
      return {
        status: 'error',
        hasApiKey: false,
        timestamp: new Date().toISOString()
      };
    }
  }

  public static async translate(req: TranslateApiRequest): Promise<TranslateApiResponse> {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return this.handleResponse<TranslateApiResponse>(res);
  }

  public static async fix(req: {
    model: string;
    items: { id: number; original: string; current: string; issue: string }[];
    sourceLang: string;
    terms?: DictionaryTerm[];
    projectNotes?: string;
  }): Promise<{ fixes: { id: number | string; vi: string }[] }> {
    const res = await fetch('/api/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return this.handleResponse<{ fixes: { id: number | string; vi: string }[] }>(res);
  }

  public static async scanTerms(req: {
    model: string;
    textSamples: string[];
    sourceLang: string;
  }): Promise<{
    terms: {
      original: string;
      vietnamese: string;
      category: string;
      notes?: string;
    }[];
  }> {
    const res = await fetch('/api/scan-terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return this.handleResponse<{ terms: any[] }>(res);
  }

  public static async qcAi(req: {
    model: string;
    pairs: { id: number; original: string; vi: string }[];
  }): Promise<{
    issues: {
      id: number | string;
      severity: 'Nặng' | 'Nhẹ' | 'Cảnh báo';
      message: string;
      suggestion?: string;
    }[];
  }> {
    const res = await fetch('/api/qc-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return this.handleResponse<{ issues: any[] }>(res);
  }
}
