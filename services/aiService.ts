
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, TradeAction, AppSettings } from "../types.ts";

export class AIService {
  private geminiClient: GoogleGenAI | null = null;

  private getGemini(apiKey: string) {
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey });
    }
    return this.geminiClient;
  }

  async analyze(settings: AppSettings, data: MarketData, currentPositionSide: string): Promise<TradeAction> {
    const prompt = `
      Analyze the current market data for ${data.symbol} and decide on a leverage trading action.
      Current Price: $${data.price}
      24h Change: ${data.change24h}%
      24h Volume: ${data.volume}
      Recent Price History: ${JSON.stringify(data.history.slice(-10))}
      Current Active Position: ${currentPositionSide}

      Respond ONLY in JSON format.
      If we have an active position, decide if we should CLOSE it based on market shifts.
      If we don't have a position, decide whether to go LONG, SHORT, or WAIT.
      Maximum recommended leverage is 20x for safety.
      
      JSON Structure:
      {
        "action": "LONG" | "SHORT" | "CLOSE" | "WAIT",
        "leverage": number,
        "reason": "string",
        "confidence": number (0-100)
      }
    `;

    try {
      if (settings.aiProvider === 'gemini') {
        // Safe check for process.env to prevent ReferenceError in browser
        const envKey = typeof process !== 'undefined' ? process.env.API_KEY : '';
        const apiKey = settings.geminiApiKey || envKey || '';
        
        if (!apiKey) {
          throw new Error("Gemini API Key missing. Please provide it in settings.");
        }

        const ai = this.getGemini(apiKey);
        const response = await ai.models.generateContent({
          model: "gemini-3-pro-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                action: { type: Type.STRING },
                leverage: { type: Type.NUMBER },
                reason: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: ["action", "leverage", "reason", "confidence"],
            },
            thinkingConfig: { thinkingBudget: 4096 }
          },
        });
        return JSON.parse(response.text || '{}') as TradeAction;
      } 
      
      if (settings.aiProvider === 'openai') {
        if (!settings.openaiApiKey) throw new Error("OpenAI API Key missing");
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openaiApiKey}`
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });
        const json = await response.json();
        if (json.error) throw new Error(json.error.message);
        return JSON.parse(json.choices[0].message.content) as TradeAction;
      }

      if (settings.aiProvider === 'deepseek') {
        if (!settings.deepseekApiKey) throw new Error("DeepSeek API Key missing");
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.deepseekApiKey}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });
        const json = await response.json();
        if (json.error) throw new Error(json.error.message);
        return JSON.parse(json.choices[0].message.content) as TradeAction;
      }

      throw new Error("Unsupported AI Provider");
    } catch (error) {
      console.error("AI Analysis Error:", error);
      return {
        action: 'WAIT',
        leverage: 1,
        reason: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        confidence: 0
      };
    }
  }
}
