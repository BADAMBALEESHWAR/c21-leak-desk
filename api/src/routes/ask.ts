import { Router } from 'express';
import { SchemaType } from '@google/generative-ai';
import { z } from 'zod';
import { cacheKey, modelFor, PROMPT_VERSION_V2, remember, takeQuota, TIMEOUT_MS, ungrounded, withTimeout, type AiModel } from '../ai/grounded.js';
import { recordAi } from '../ai/guardlog.js';
import { langOf } from '../ai/localize.js';
import { PHRASES } from '../ai/phrases.js';
import { isLang, LANGUAGE_NAMES, type Lang } from '../ai/templates.js';
import { linkFor, parseModelCall, routeQuestion, runTool, templateAnswer, TOOL_DECLARATIONS, type ToolCall, type ToolContext } from '../ai/tools.js';
import { ah } from '../errors.js';
import { logger } from '../logger.js';
import { ledgerOptionsOf, loadAnalysis } from './analyses.js';

// Ask Profyn (v2 §1.3): a question → one read-only tool over the engine's output → an answer phrased from that
// tool's JSON only. With AI: Gemini picks the tool and phrases; every figure in the answer must appear in the tool
// result, otherwise the answer is withheld (source "table") and the UI shows the result table instead.

export const askRouter = Router();

const AskRequestSchema = z.object({ question: z.string().trim().min(1, 'ask a question').max(500), lang: z.string().optional() });

export const ASK_TOOL_PROMPT = `You route questions from the owner of a small Indian D2C brand to exactly one tool over their own order data.
Pick the single tool that answers the question and fill only the arguments the question states. Months are YYYY-MM.`;

export const ASK_PHRASE_PROMPT = `You answer the owner of a small Indian D2C brand in one to three short sentences.
Use ONLY the tool result JSON you are given; the draft answer is already correct and may be reworded.
Rules: copy every number exactly as it appears in the result, in Latin digits; never compute, round, convert or add figures;
never invent products, channels, months or order IDs; do not say advertising caused sales; say contribution, never profit or margin.
Reply in the language the request names. Return JSON {"answer": string}.`;

const ANSWER_SCHEMA = { type: SchemaType.OBJECT, properties: { answer: { type: SchemaType.STRING } }, required: ['answer'] };

interface AiAnswer {
  call: ToolCall | null;
  answer: string | null;
}
const cache = new Map<string, AiAnswer>();

const errorReason = (err: unknown) => {
  const msg = (err as Error).message;
  return msg === 'timeout' ? 'timeout' : /429|quota|rate/i.test(msg) ? 'quota' : 'error';
};

async function chooseTool(model: AiModel, question: string, lang: Lang): Promise<ToolCall | null> {
  if (!model.chooseTool || !takeQuota()) return null;
  try {
    const picked = await withTimeout(model.chooseTool(ASK_TOOL_PROMPT, `Language: ${LANGUAGE_NAMES[lang]}.\nQuestion: ${question}`, TOOL_DECLARATIONS), TIMEOUT_MS);
    recordAi('ask', 'call');
    return parseModelCall(picked);
  } catch (err) {
    recordAi('ask', 'call');
    recordAi('ask', 'error');
    logger.warn({ err: (err as Error).message, reason: errorReason(err) }, 'ask tool choice failed; keyword router used');
    return null;
  }
}

async function phrase(model: AiModel, question: string, call: ToolCall, result: unknown, draft: string, lang: Lang): Promise<string | null | undefined> {
  if (!takeQuota()) return undefined;
  try {
    const raw = await withTimeout(
      model.generate(ASK_PHRASE_PROMPT, `Reply in ${LANGUAGE_NAMES[lang]}.\n${JSON.stringify({ question, tool: call, result, draft })}`, ANSWER_SCHEMA),
      TIMEOUT_MS,
    );
    recordAi('ask', 'call');
    const parsed = JSON.parse(raw) as { answer?: unknown };
    return typeof parsed?.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : null;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    recordAi('ask', 'call');
    recordAi('ask', 'error');
    logger.warn({ err: (err as Error).message }, 'ask phrasing failed; template used');
    return undefined;
  }
}

askRouter.post(
  '/analyses/:id/ask',
  ah(async (req, res) => {
    const body = AskRequestSchema.parse(req.body ?? {});
    const lang = isLang(body.lang) ? body.lang : langOf(req, res);
    const { analysis, dataset } = await loadAnalysis(req.params.id, req.user);
    const ctx: ToolContext = { a: analysis.result, rows: dataset.rows, opts: ledgerOptionsOf(analysis) };
    const model = modelFor(req, dataset);
    const key = model ? cacheKey('ask', analysis._id, body.question, lang, model.model, PROMPT_VERSION_V2) : '';
    const hit = model ? cache.get(key) : undefined;

    // 1. Pick the tool: the model's call when it is valid, else the keyword router.
    const routed = routeQuestion(body.question, ctx.a);
    let call = (hit ? hit.call : model ? await chooseTool(model, body.question, lang) : null) ?? routed;
    let result: Record<string, unknown>;
    try {
      result = runTool(call, ctx);
    } catch (err) {
      if (call === routed) throw err;
      call = routed;
      result = runTool(call, ctx);
    }
    const template = templateAnswer(call, result, lang);
    const base = { tool: { name: call.name, args: call.args }, result, link: linkFor(call, result), lang };
    if (!model) return void res.json({ answer: template, source: 'template', ...base, rejected: false });

    // 2. Phrase from the tool JSON only; any figure not in the result (or the question) withholds the answer.
    const text = hit ? hit.answer : await phrase(model, body.question, call, result, template, lang);
    if (text === undefined) return void res.json({ answer: template, source: 'template', ...base, rejected: false });
    const bad = text === null ? 'malformed' : ungrounded(text, JSON.stringify(result) + ' ' + JSON.stringify(call.args) + ' ' + body.question);
    if (!hit) {
      recordAi('ask', bad ? 'rejected' : 'accepted');
      remember(cache, key, { call, answer: text });
    }
    if (bad) {
      req.log.info({ analysis_id: analysis._id, tool: call.name, guard: bad }, 'ask answer rejected');
      return void res.json({ answer: null, source: 'table', ...base, rejected: true, message: PHRASES[lang].unsafe });
    }
    res.json({ answer: text, source: 'ai', ...base, rejected: false });
  }),
);
