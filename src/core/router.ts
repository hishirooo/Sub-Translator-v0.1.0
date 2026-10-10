import { ModelConfig, AppSettings } from '../types';

export interface RequestRecord {
  modelId: string;
  timestamp: number;
}

export interface RouterDecision {
  action: 'proceed' | 'wait' | 'exhausted';
  model?: ModelConfig;
  waitMs?: number;
  reason: string;
}

export class ModelRouter {
  private settings: AppSettings;
  private requestHistory: RequestRecord[] = [];
  private onStateChange?: (models: ModelConfig[]) => void;

  constructor(settings: AppSettings, onStateChange?: (models: ModelConfig[]) => void) {
    this.settings = settings;
    this.onStateChange = onStateChange;
  }

  public updateSettings(newSettings: AppSettings) {
    this.settings = newSettings;
  }

  // Get active requests for model within last 60 seconds
  private getActiveRpmCount(modelId: string, now: number = Date.now()): number {
    const windowStart = now - 60000;
    return this.requestHistory.filter(r => r.modelId === modelId && r.timestamp > windowStart).length;
  }

  // Next slot availability in milliseconds
  private getTimeUntilNextRpmSlot(model: ModelConfig, now: number = Date.now()): number {
    const windowStart = now - 60000;
    const modelReqs = this.requestHistory
      .filter(r => r.modelId === model.id && r.timestamp > windowStart)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (modelReqs.length < model.rpmLimit) return 0;
    const oldest = modelReqs[0];
    const wait = (oldest.timestamp + 60000) - now;
    return Math.max(0, wait);
  }

  // Select model for batch translation
  public selectTranslatorModel(isDifficult = false, excludeModelId?: string): RouterDecision {
    const now = Date.now();
    // Clean old history older than 5 minutes
    this.requestHistory = this.requestHistory.filter(r => now - r.timestamp < 300000);

    const translateModels = this.settings.models
      .filter(m => m.role === 'translate' || m.role === 'pro-backup')
      .sort((a, b) => a.priority - b.priority);

    // Filter available models (not in cooldown, RPD remaining)
    const validModels = translateModels.filter(m => {
      if (!m.isAvailable) return false;
      if (m.rpdUsed >= m.rpdLimit) return false;
      if (m.cooldownUntil && m.cooldownUntil > now) return false;
      return true;
    });

    if (validModels.length === 0) {
      return {
        action: 'exhausted',
        reason: 'Tất cả các model dịch đã hết quota ngày (RPD) hoặc đang trong thời gian phạt 429.'
      };
    }

    // Identify Flash models and Pro models
    const flashModels = validModels.filter(m => m.role === 'translate' && m.id !== excludeModelId);
    const proModel = validModels.find(m => m.role === 'pro-backup');

    // 1. Check if any Flash model has immediate slot
    for (const flash of flashModels) {
      const activeRpm = this.getActiveRpmCount(flash.id, now);
      if (activeRpm < flash.rpmLimit) {
        return {
          action: 'proceed',
          model: flash,
          reason: `${flash.displayName} sẵn sàng (RPM ${activeRpm}/${flash.rpmLimit}, RPD còn ${flash.rpdLimit - flash.rpdUsed})`
        };
      }
    }

    // 2. All Flash models are full on RPM. Check wait time for Flash
    let minFlashWait = Infinity;
    for (const flash of flashModels) {
      const wait = this.getTimeUntilNextRpmSlot(flash, now);
      if (wait < minFlashWait) minFlashWait = wait;
    }

    // Pro protection logic:
    // If batch is NOT difficult, and a Flash model will be free within proProtectionSec (e.g. 30s), WAIT for Flash!
    const protectionLimitMs = (this.settings.proProtectionSec || 30) * 1000;

    if (!isDifficult && minFlashWait <= protectionLimitMs && minFlashWait < Infinity) {
      return {
        action: 'wait',
        waitMs: minFlashWait + 200,
        reason: `Bảo vệ quota Pro: Chờ Flash mở slot sau ${Math.ceil(minFlashWait / 1000)}s thay vì dùng Pro.`
      };
    }

    // 3. If batch is difficult OR Flash wait > 30s, and Pro is available
    if (proModel && (isDifficult || minFlashWait > protectionLimitMs)) {
      const proRpm = this.getActiveRpmCount(proModel.id, now);
      if (proRpm < proModel.rpmLimit) {
        return {
          action: 'proceed',
          model: proModel,
          reason: isDifficult
            ? `${proModel.displayName} được kích hoạt cho batch khó`
            : `${proModel.displayName} nhận việc do Flash chờ quá ${Math.ceil(protectionLimitMs / 1000)}s`
        };
      }
    }

    // 4. Otherwise, calculate minimum wait across all valid models
    let overallMinWait = minFlashWait;
    if (proModel) {
      const proWait = this.getTimeUntilNextRpmSlot(proModel, now);
      if (proWait < overallMinWait) overallMinWait = proWait;
    }

    return {
      action: 'wait',
      waitMs: (overallMinWait === Infinity ? 5000 : overallMinWait) + 200,
      reason: `Tất cả model đang đầy RPM. Chờ slot mở sau ${Math.ceil(overallMinWait / 1000)}s.`
    };
  }

  // Select Lite model for auto-fixing light issues
  public selectLiteModel(): RouterDecision {
    const now = Date.now();
    const liteModels = this.settings.models
      .filter(m => m.role === 'lite-fix')
      .sort((a, b) => a.priority - b.priority);

    const validLite = liteModels.filter(m => {
      if (!m.isAvailable) return false;
      if (m.rpdUsed >= m.rpdLimit) return false;
      if (m.cooldownUntil && m.cooldownUntil > now) return false;
      return true;
    });

    if (validLite.length === 0) {
      return {
        action: 'exhausted',
        reason: 'Các model Lite đã hết quota hoặc đang cooldown.'
      };
    }

    for (const lite of validLite) {
      const activeRpm = this.getActiveRpmCount(lite.id, now);
      if (activeRpm < lite.rpmLimit) {
        return {
          action: 'proceed',
          model: lite,
          reason: `${lite.displayName} sẵn sàng sửa nhẹ (RPM ${activeRpm}/${lite.rpmLimit})`
        };
      }
    }

    let minWait = Infinity;
    for (const lite of validLite) {
      const wait = this.getTimeUntilNextRpmSlot(lite, now);
      if (wait < minWait) minWait = wait;
    }

    return {
      action: 'wait',
      waitMs: minWait + 200,
      reason: `Model Lite đầy RPM, chờ ${Math.ceil(minWait / 1000)}s.`
    };
  }

  // Reserve slot and record request
  public recordRequest(modelId: string) {
    const now = Date.now();
    this.requestHistory.push({ modelId, timestamp: now });

    const model = this.settings.models.find(m => m.id === modelId);
    if (model) {
      model.rpdUsed += 1;
      model.activeRpm = this.getActiveRpmCount(modelId, now);
      this.notifyState();
    }
  }

  // Handle 429 Rate Limit error
  public record429(modelId: string): { consecutiveCount: number; cooldownSec: number; isExhaustedToday: boolean } {
    const now = Date.now();
    const model = this.settings.models.find(m => m.id === modelId);
    if (!model) return { consecutiveCount: 0, cooldownSec: 60, isExhaustedToday: false };

    model.consecutive429s = (model.consecutive429s || 0) + 1;
    const cooldownSec = 60;
    model.cooldownUntil = now + cooldownSec * 1000;

    let isExhaustedToday = false;
    if (model.consecutive429s >= 3) {
      // Mark as exhausted for the rest of today
      model.rpdUsed = model.rpdLimit;
      isExhaustedToday = true;
    }

    this.notifyState();
    return {
      consecutiveCount: model.consecutive429s,
      cooldownSec,
      isExhaustedToday
    };
  }

  // Clear 429 counter on successful response
  public recordSuccess(modelId: string) {
    const model = this.settings.models.find(m => m.id === modelId);
    if (model) {
      model.consecutive429s = 0;
      this.notifyState();
    }
  }

  // Periodic refresh of RPM counters
  public refreshActiveRpms() {
    const now = Date.now();
    for (const m of this.settings.models) {
      m.activeRpm = this.getActiveRpmCount(m.id, now);
    }
    this.notifyState();
  }

  // Reset daily quotas (e.g. at reset hour)
  public resetDailyQuotas() {
    for (const m of this.settings.models) {
      m.rpdUsed = 0;
      m.consecutive429s = 0;
      m.cooldownUntil = 0;
    }
    this.notifyState();
  }

  private notifyState() {
    if (this.onStateChange) {
      this.onStateChange([...this.settings.models]);
    }
  }
}
