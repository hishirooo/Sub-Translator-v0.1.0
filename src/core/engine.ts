import { SubtitleProject, DictionaryTerm, AppSettings, SubtitleLine, SubtitleStatus } from '../types';
import { BatchPlanner, PlannedBatch, isLineNonTranslatable } from './batch';
import { ModelRouter, RouterDecision } from './router';
import { GeminiApiClient } from './gemini';
import { QualityChecker } from './qc';
import { logger } from './logger';
import { appStorage } from './storage';

export type EngineStatus = 'idle' | 'running' | 'paused' | 'exhausted';

export class TranslationEngine {
  private project: SubtitleProject;
  private terms: DictionaryTerm[];
  private settings: AppSettings;
  private router: ModelRouter;
  private batchPlanner: BatchPlanner;
  private status: EngineStatus = 'idle';
  private stopRequested = false;
  private activeWorkers = 0;
  private inFlightBatches = new Set<Promise<boolean>>();
  private persistenceQueue: Promise<void> = Promise.resolve();
  private onProjectChange: (project: SubtitleProject) => void;
  private onStatusChange: (status: EngineStatus) => void;

  constructor(
    project: SubtitleProject,
    terms: DictionaryTerm[],
    settings: AppSettings,
    router: ModelRouter,
    onProjectChange: (project: SubtitleProject) => void,
    onStatusChange: (status: EngineStatus) => void
  ) {
    this.project = project;
    this.terms = terms;
    this.settings = settings;
    this.router = router;
    this.batchPlanner = new BatchPlanner();
    this.onProjectChange = onProjectChange;
    this.onStatusChange = onStatusChange;

    // Seed cache with any existing Done lines
    for (const l of project.lines) {
      if (l.status === 'Done' && l.cleanedText && l.viText) {
        this.batchPlanner.setCachedTranslation(l.cleanedText, l.viText);
      }
    }
  }

  public updateProject(project: SubtitleProject) {
    // Explicit user edits go through the same ordered snapshot/persistence path
    // as API results; otherwise an older batch's async save can overwrite them.
    this.project = project;
    this.notifyProjectUpdate();
  }

  public updateTerms(terms: DictionaryTerm[]) {
    this.terms = terms;
  }

  public updateSettings(settings: AppSettings) {
    this.settings = settings;
    this.router.updateSettings(settings);
  }

  public getStatus(): EngineStatus {
    return this.status;
  }

  public async start() {
    if (this.status === 'running') return;
    // A user can press Start while the previous pause is still draining API requests.
    // Never overlap two runners on the same project.
    if (this.inFlightBatches.size > 0) {
      await Promise.allSettled([...this.inFlightBatches]);
    }
    if ((this.status as EngineStatus) === 'running') return;
    this.stopRequested = false;
    this.status = 'running';
    this.onStatusChange('running');

    logger.log({
      type: 'FILE',
      level: 'info',
      message: `Khởi động tiến trình dịch [Chế độ ${this.settings.runMode === 'parallel' ? 'Song song' : 'Tuần tự'}] cho file "${this.project.fileName}" (${this.project.lines.length} dòng).`
    });

    try {
      if (this.settings.runMode === 'parallel') {
        await this.runParallelLoop();
      } else {
        await this.runSequentialLoop();
      }
    } finally {
      // Even when the scheduler stops/pause is requested, already-sent requests
      // finish and commit their batch before the runner is considered settled.
      if (this.inFlightBatches.size > 0) {
        await Promise.allSettled([...this.inFlightBatches]);
      }
      await this.persistenceQueue;
      if ((this.status as EngineStatus) !== 'exhausted' && !this.stopRequested) {
        this.status = 'idle';
        this.onStatusChange('idle');
      }
    }
  }

  public pause() {
    this.stopRequested = true;
    this.status = 'paused';
    this.onStatusChange('paused');
    logger.log({
      type: 'FILE',
      level: 'warn',
      message: 'Người dùng tạm dừng tiến trình dịch.'
    });
  }

  // Pre-filter lines that don't need translation (e.g. musical notes, symbols)
  private processNonTranslatableAndCachedLines() {
    let updated = false;
    for (const line of this.project.lines) {
      if (line.status === 'Waiting' && !line.isLocked) {
        // Pure symbols / musical notes
        if (isLineNonTranslatable(line.cleanedText)) {
          line.viText = line.cleanedText;
          line.status = 'Done';
          updated = true;
          continue;
        }

        // Cache hit
        const cached = this.batchPlanner.getCachedTranslation(line.cleanedText);
        if (cached) {
          line.viText = cached;
          line.status = 'Done';
          updated = true;
        }
      }
    }

    if (updated) {
      this.notifyProjectUpdate();
    }
  }

  // Main Sequential processing loop
  private async runSequentialLoop() {
    this.processNonTranslatableAndCachedLines();

    while (!this.stopRequested) {
      const batches = this.batchPlanner.planBatches(this.project.lines, this.terms, this.settings);
      if (batches.length === 0) {
        logger.log({
          type: 'FILE',
          level: 'info',
          message: 'Tất cả các dòng phụ đề đã hoàn tất!'
        });
        break;
      }

      const batch = batches[0];
      const success = await this.executeBatchWithRouter(batch);
      if (!success && this.status === 'exhausted') {
        break;
      }

      await new Promise(r => setTimeout(r, 200));
    }
  }

  // Main Parallel processing loop
  private async runParallelLoop() {
    this.processNonTranslatableAndCachedLines();

    while (!this.stopRequested) {
      const batches = this.batchPlanner.planBatches(this.project.lines, this.terms, this.settings);
      if (batches.length === 0 && this.activeWorkers === 0) {
        logger.log({
          type: 'FILE',
          level: 'info',
          message: 'Tất cả các dòng phụ đề đã hoàn tất!'
        });
        break;
      }

      // No pending batches: wait for in-flight requests instead of spinning on RPM.
      if (batches.length === 0) {
        await Promise.race([...this.inFlightBatches]);
        continue;
      }

      // Check available translation slots across models
      const decision = this.router.selectTranslatorModel();
      if (decision.action === 'exhausted') {
        this.status = 'exhausted';
        this.onStatusChange('exhausted');
        logger.log({
          type: 'LỖI',
          level: 'error',
          message: decision.reason
        });
        break;
      }

      if (decision.action === 'wait') {
        logger.log({
          type: 'CHỜ',
          level: 'info',
          message: decision.reason
        });
        await new Promise(r => setTimeout(r, Math.min(decision.waitMs || 5000, 10000)));
        continue;
      }

      if (batches.length > 0) {
        const batch = batches[0];
        // Mark as Processing immediately so next parallel iteration doesn't re-select same batch
        this.markBatchStatus(batch.lineIds, 'Processing');
        this.activeWorkers++;

        const task = this.executeBatchWithRouter(batch);
        this.inFlightBatches.add(task);
        void task.finally(() => {
          this.activeWorkers--;
          this.inFlightBatches.delete(task);
        });
      }

      // Small pause to prevent CPU burn
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Execute a single batch using ModelRouter
  private async executeBatchWithRouter(batch: PlannedBatch): Promise<boolean> {
    let retries = 0;
    let excludeModelId: string | undefined;

    while (retries < 3 && !this.stopRequested) {
      const decision: RouterDecision = this.router.selectTranslatorModel(batch.isDifficult, excludeModelId);

      if (decision.action === 'exhausted') {
        this.status = 'exhausted';
        this.onStatusChange('exhausted');
        logger.log({
          type: 'LỖI',
          level: 'error',
          batchIndex: batch.index,
          message: decision.reason
        });
        this.markBatchStatus(batch.lineIds, 'Waiting');
        return false;
      }

      if (decision.action === 'wait') {
        logger.log({
          type: 'CHỜ',
          level: 'info',
          batchIndex: batch.index,
          message: decision.reason
        });
        await new Promise(r => setTimeout(r, Math.min(decision.waitMs || 5000, 15000)));
        continue;
      }

      const model = decision.model!;
      const modelId = model.id;
      const startTime = Date.now();
      const firstId = batch.lineIds[0];
      const lastId = batch.lineIds[batch.lineIds.length - 1];
      const lineRange = `#${firstId}–${lastId}`;

      // Reserve slot
      this.router.recordRequest(modelId);
      this.markBatchStatus(batch.lineIds, 'Processing');

      logger.log({
        type: 'GỬI',
        level: 'info',
        batchIndex: batch.index,
        lineRange,
        modelName: model.displayName,
        rpmStatus: `RPM ${model.activeRpm}/${model.rpmLimit}, còn ${model.rpmLimit - model.activeRpm}`,
        rpdStatus: `RPD ${model.rpdUsed}/${model.rpdLimit}, còn ${model.rpdLimit - model.rpdUsed}`,
        message: `GỬI batch #${batch.index} | ${batch.lineIds.length} dòng (${lineRange}) | ${model.displayName} | RPM ${model.activeRpm}/${model.rpmLimit} | RPD ${model.rpdUsed}/${model.rpdLimit}`
      });

      try {
        const response = await GeminiApiClient.translate({
          model: modelId,
          items: batch.itemsToTranslate,
          sourceLang: this.project.sourceLang,
          targetLang: this.project.targetLang,
          projectNotes: this.project.projectNotes,
          terms: batch.relevantTerms,
          previousContext: batch.previousContext,
          nextContext: batch.nextContext
        });

        const durationMs = Date.now() - startTime;
        const durationSec = (durationMs / 1000).toFixed(1);
        this.router.recordSuccess(modelId);

        // Apply received translations
        const receivedTranslations = response.translations || [];
        const evalResult = QualityChecker.evaluateBatchResult(batch.lineIds, receivedTranslations);

        logger.log({
          type: 'NHẬN',
          level: evalResult.isHeavyError ? 'warn' : 'info',
          batchIndex: batch.index,
          durationMs,
          tokenInput: response.usage?.promptTokens,
          tokenOutput: response.usage?.responseTokens,
          message: `NHẬN batch #${batch.index} | ${durationSec}s | ${receivedTranslations.length}/${batch.lineIds.length} dòng hợp lệ | ${evalResult.lightIssueLineIds.length} lỗi nhẹ | ${evalResult.isHeavyError ? '1' : '0'} lỗi nặng | token vào ${response.usage?.promptTokens || 0}, ra ${response.usage?.responseTokens || 0}`
        });

        if (evalResult.isHeavyError) {
          // Retry entire batch with different model
          logger.log({
            type: 'DỊCH LẠI',
            level: 'warn',
            batchIndex: batch.index,
            message: `Batch #${batch.index} gặp lỗi nặng (thiếu nhiều dòng hoặc cấu trúc sai) -> chuyển sang model khác để dịch lại.`
          });
          excludeModelId = modelId;
          retries++;
          continue;
        }

        // Map translations to lines. Publish a snapshot immediately after receiving
        // each batch; do not wait for Lite auto-fix or for all other batches to finish.
        const linesToFix: { line: SubtitleLine; issueMsg: string }[] = [];
        const transMap = new Map<number, string>();
        for (const t of receivedTranslations) {
          const id = typeof t.id === 'string' ? parseInt(t.id, 10) : t.id;
          if (!isNaN(id)) {
            transMap.set(id, t.vi || '');
          }
        }

        const inputMap = new Map(batch.itemsToTranslate.map(item => [item.id, item.text]));
        const getCurrentBatchLines = () => batch.lineIds
          .map(id => this.project.lines.find(line => line.id === id))
          .filter((line): line is SubtitleLine => Boolean(line))
          // Don't replace a manual edit or changed source after a request was sent.
          .filter(line => !line.isLocked &&
            (line.status === 'Processing' || line.status === 'Fixing') &&
            line.cleanedText.replace(/\n/g, '[[NL]]') === inputMap.get(line.id));
        const batchLines = getCurrentBatchLines();

        for (const line of batchLines) {
          const translatedVi = transMap.get(line.id);
          if (translatedVi !== undefined) {
            line.viText = translatedVi;
            line.status = 'Done';
            line.errorDescription = undefined;
          } else {
            // An incomplete response below the heavy-error threshold must never
            // silently turn into a successful stale/empty subtitle.
            line.viText = '';
            line.status = 'Fixing';
          }
        }
        this.notifyProjectUpdate(); // live results visible while other API calls run
        logger.log({
          type: 'NHẬN',
          level: 'info',
          batchIndex: batch.index,
          message: `HIỂN THỊ batch #${batch.index} | đã cập nhật ${batchLines.filter(l => l.viText).length}/${batch.lineIds.length} dòng ngay trên bảng.`
        });

        // Yield one turn so React gets a chance to paint before local QC/Lite runs.
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        const approvedTerms = this.terms.filter(t => t.status === 'approved');
        for (const line of batch.lineIds
          .map(id => this.project.lines.find(current => current.id === id))
          .filter((line): line is SubtitleLine => Boolean(line) && !line!.isLocked)
          .filter(line => line.cleanedText.replace(/\n/g, '[[NL]]') === inputMap.get(line.id))) {
          // Manual edits or locks made after the request started take precedence.
          if (line.isLocked || line.status !== 'Done' && line.status !== 'Fixing') continue;
          const qcIssues = QualityChecker.checkLine(
            line,
            approvedTerms,
            this.settings.readingSpeedCpsLimit,
            this.settings.maxLineLength
          );
          line.qcIssues = qcIssues;
          const lightIssue = qcIssues.find(i => i.severity === 'Nhẹ');
          if (lightIssue) {
            line.status = 'Fixing';
            line.errorDescription = lightIssue.message;
            linesToFix.push({ line, issueMsg: lightIssue.message });
          } else {
            line.status = 'Done';
            this.batchPlanner.setCachedTranslation(line.cleanedText, line.viText);
          }
        }
        this.notifyProjectUpdate();

        // If there are light issues, attempt auto-fix via Lite model
        if (linesToFix.length > 0) {
          await this.autoFixLinesWithLite(linesToFix, batch.index);
        }

        return true;
      } catch (err: any) {
        const is429 = err.status === 429 || err.message?.includes('429');
        if (is429) {
          const { consecutiveCount, cooldownSec, isExhaustedToday } = this.router.record429(modelId);
          logger.log({
            type: 'LỖI',
            level: 'error',
            batchIndex: batch.index,
            modelName: model.displayName,
            message: `LỖI batch #${batch.index} | ${model.displayName} trả 429 (lần ${consecutiveCount}) | cooldown ${cooldownSec}s ${isExhaustedToday ? '| Đã hết quota hôm nay' : '| Thử lại bằng model khác'}`
          });
          excludeModelId = modelId;
          retries++;
          continue;
        }

        logger.log({
          type: 'LỖI',
          level: 'error',
          batchIndex: batch.index,
          modelName: model.displayName,
          message: `LỖI batch #${batch.index} (${model.displayName}): ${err.message || 'Lỗi không xác định'}`
        });

        retries++;
        await new Promise(r => setTimeout(r, 2000 * retries));
      }
    }

    // If all retries failed, mark as Error for user inspection
    this.markBatchStatus(batch.lineIds, 'Error');
    return false;
  }

  // Auto-fix light issues using Lite model
  private async autoFixLinesWithLite(
    items: { line: SubtitleLine; issueMsg: string }[],
    batchIndex: number
  ) {
    const liteDecision = this.router.selectLiteModel();
    if (liteDecision.action !== 'proceed') {
      logger.log({
        type: 'SỬA NHẸ',
        level: 'warn',
        batchIndex,
        message: `Không có model Lite khả dụng (${liteDecision.reason}) -> giữ nguyên các dòng để người dùng duyệt.`
      });
      for (const item of items) {
        item.line.status = 'Done';
      }
      this.notifyProjectUpdate();
      return;
    }

    const liteModel = liteDecision.model!;
    this.router.recordRequest(liteModel.id);

    logger.log({
      type: 'SỬA NHẸ',
      level: 'info',
      batchIndex,
      modelName: liteModel.displayName,
      message: `SỬA NHẸ batch #${batchIndex} | ${items.length} dòng | ${liteModel.displayName} | RPM ${liteModel.activeRpm}/${liteModel.rpmLimit}`
    });

    try {
      const fixPayload = items.map(i => ({
        id: i.line.id,
        original: i.line.cleanedText,
        current: i.line.viText,
        issue: i.issueMsg
      }));

      const res = await GeminiApiClient.fix({
        model: liteModel.id,
        items: fixPayload,
        sourceLang: this.project.sourceLang,
        terms: this.terms.filter(t => t.status === 'approved'),
        projectNotes: this.project.projectNotes
      });

      const fixes = res.fixes || [];
      const fixMap = new Map<number, string>();
      for (const f of fixes) {
        const id = typeof f.id === 'string' ? parseInt(f.id, 10) : f.id;
        if (!isNaN(id)) fixMap.set(id, f.vi);
      }

      for (const item of items) {
        const fixedText = fixMap.get(item.line.id);
        if (fixedText) {
          item.line.viText = fixedText;
        }
        item.line.fixAttempts = (item.line.fixAttempts || 0) + 1;
        item.line.status = 'Done';
        item.line.qcIssues = QualityChecker.checkLine(
          item.line,
          this.terms.filter(t => t.status === 'approved'),
          this.settings.readingSpeedCpsLimit,
          this.settings.maxLineLength
        );
        this.batchPlanner.setCachedTranslation(item.line.cleanedText, item.line.viText);
      }

      this.notifyProjectUpdate();
    } catch (err: any) {
      logger.log({
        type: 'LỖI',
        level: 'warn',
        batchIndex,
        message: `Lỗi khi tự sửa nhẹ bằng ${liteModel.displayName}: ${err.message}`
      });
      for (const item of items) {
        item.line.status = 'Done';
      }
      this.notifyProjectUpdate();
    }
  }

  private markBatchStatus(lineIds: number[], status: SubtitleStatus) {
    for (const id of lineIds) {
      const line = this.project.lines.find(l => l.id === id);
      if (line && !line.isLocked) {
        line.status = status;
      }
    }
    this.notifyProjectUpdate();
  }

  private notifyProjectUpdate() {
    this.project.updatedAt = Math.max(Date.now(), this.project.updatedAt + 1);
    // Never let React/IndexedDB retain mutable references to the live worker data.
    // This also prevents a later batch from changing an earlier UI snapshot.
    const snapshot: SubtitleProject = {
      ...this.project,
      lines: this.project.lines.map(line => ({
        ...line,
        qcIssues: line.qcIssues?.map(issue => ({ ...issue }))
      }))
    };
    this.onProjectChange(snapshot);
    // Serialize writes: slower IndexedDB transactions must not overwrite newer
    // batch progress. In-memory UI updates remain immediate.
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(() => appStorage.saveProject(snapshot))
      .catch(error => {
        logger.log({ type: 'LỖI', level: 'warn', message: `Lưu tiến độ thất bại: ${String(error)}` });
      });
  }
}
