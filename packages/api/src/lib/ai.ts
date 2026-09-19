import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const MODEL_NAME = "gemini-3.5-flash-lite";

export interface AIUsageLog {
  purpose: string;
  model: string;
  latencyMs: number;
  success: boolean;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
}

export const aiUsageLog: AIUsageLog[] = [];

function logUsage(entry: AIUsageLog) {
  aiUsageLog.push(entry);
  if (aiUsageLog.length > 500) aiUsageLog.shift();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryDelayMs(err: any): number {
  const msg = String(err?.message || err);
  const match = msg.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500; // small buffer
  return 5000; // default backoff if we can't parse one
}

function isRateLimitError(err: any): boolean {
  return String(err?.message || err).includes("429") || String(err?.message || err).includes("Too Many Requests");
}

/**
 * Generates structured, schema-validated output from the model.
 * Handles two distinct failure modes with different retry strategies:
 *  - Rate limit (429): wait the server-suggested delay, then retry (up to 3x).
 *  - Invalid/malformed output: one controlled repair retry with the error fed back in.
 * Repeated failure of either kind becomes an explicit operational failure
 * (Section 15/24 requirement) rather than being silently accepted.
 */
export async function generateStructured<T>(
  purpose: string,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>
): Promise<T> {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: systemPrompt,
    generationConfig: { responseMimeType: "application/json" },
  });

  async function rawCall(promptText: string): Promise<{ raw: string; parsed: T }> {
    const start = Date.now();
    try {
      const result = await model.generateContent(promptText);
      const raw = result.response.text();
      const latencyMs = Date.now() - start;

      const json = JSON.parse(raw);
      const validated = schema.parse(json);

      logUsage({ purpose, model: MODEL_NAME, latencyMs, success: true });
      return { raw, parsed: validated };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      logUsage({ purpose, model: MODEL_NAME, latencyMs, success: false, error: String(err?.message || err) });
      throw err;
    }
  }

  // Wraps rawCall with rate-limit-aware retry (up to 3 attempts)
  async function callWithRateLimitRetry(promptText: string): Promise<{ raw: string; parsed: T }> {
    let lastErr: any;
    for (let i = 0; i < 3; i++) {
      try {
        return await rawCall(promptText);
      } catch (err: any) {
        lastErr = err;
        if (isRateLimitError(err)) {
          const delay = extractRetryDelayMs(err);
          console.log(`  [rate limit] waiting ${Math.round(delay / 1000)}s before retry (${purpose})...`);
          await sleep(delay);
          continue;
        }
        throw err; // non-rate-limit error, don't retry here
      }
    }
    throw lastErr;
  }

  try {
    const { parsed } = await callWithRateLimitRetry(userPrompt);
    return parsed;
  } catch (firstErr: any) {
    if (isRateLimitError(firstErr)) {
      // Exhausted rate-limit retries -> explicit operational failure
      throw new Error(`AI structured generation failed for "${purpose}": persistent rate limiting: ${String(firstErr?.message || firstErr)}`);
    }

    // Controlled repair retry for malformed/invalid output
    const repairPrompt = `${userPrompt}\n\nYour previous response was invalid: ${String(
      firstErr?.message || firstErr
    )}\nRespond again with ONLY valid JSON matching the required schema. No extra text.`;

    try {
      const { parsed } = await callWithRateLimitRetry(repairPrompt);
      return parsed;
    } catch (secondErr: any) {
      throw new Error(
        `AI structured generation failed for "${purpose}" after repair attempt: ${String(
          secondErr?.message || secondErr
        )}`
      );
    }
  }
}