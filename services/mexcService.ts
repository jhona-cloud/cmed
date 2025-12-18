
import { MarketData, AppSettings, MexcBalance, MexcOrder, MexcTransfer, MexcTrade, Position, PositionSide } from "../types.ts";

export interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
  timestamp: number;
}

export class MexcService {
  private baseFuturesUrl = "https://fapi.mexc.com";
  private baseSpotUrl = "https://api.mexc.com";

  private async sign(params: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(params);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, msgData);
    return Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async privateRequest(baseUrl: string, endpoint: string, method: string, settings: AppSettings, params: Record<string, any> = {}) {
    if (!settings.mexcApiKey || !settings.mexcSecretKey) {
      throw new Error("MEXC API Keys are missing.");
    }

    const timestamp = Date.now();
    const queryParams = new URLSearchParams({ ...params, timestamp: timestamp.toString() }).toString();
    const signature = await this.sign(queryParams, settings.mexcSecretKey);
    let targetUrl = `${baseUrl}${endpoint}?${queryParams}&signature=${signature}`;

    let requestUrl = targetUrl;
    if (settings.corsProxyUrl && settings.corsProxyUrl.trim() !== '') {
      const proxy = settings.corsProxyUrl.trim();
      if (proxy.includes('?url=')) {
        requestUrl = `${proxy}${encodeURIComponent(targetUrl)}`;
      } else {
        const separator = proxy.endsWith('/') ? '' : '/';
        requestUrl = `${proxy}${separator}${targetUrl}`;
      }
    }

    try {
      const response = await fetch(requestUrl, {
        method,
        headers: {
          "X-MEXC-APIKEY": settings.mexcApiKey,
          "Content-Type": "application/json"
        }
      });

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const result = await response.json();
        if (!response.ok || (result.code !== undefined && result.code !== 200 && result.code !== 0)) {
          throw new Error(result.msg || result.message || `MEXC Error ${result.code || response.status}`);
        }
        return result;
      } else {
        const text = await response.text();
        if (text.includes("cors-anywhere") && text.includes("corsdemo")) {
          throw new Error("Proxy Activation Required: Visit https://cors-anywhere.herokuapp.com/corsdemo and click the button.");
        }
        if (!response.ok) throw new Error(`Proxy/Network Error: ${text.substring(0, 50)}...`);
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error(`Invalid JSON from Proxy: ${text.substring(0, 50)}`);
        }
      }
    } catch (e: any) {
      if (e instanceof TypeError || e.message?.includes('fetch')) {
        throw new Error("CORS/Proxy Error. Use a Browser Extension or set a valid Proxy URL.");
      }
      throw e;
    }
  }

  async getTicker(symbol: string): Promise<TickerData> {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}`);
    if (!response.ok) throw new Error(`Market API unreachable`);
    const data = await response.json();
    return {
      symbol: symbol.toUpperCase(),
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent),
      volume: parseFloat(data.volume),
      timestamp: Date.now()
    };
  }

  async getSpotBalance(settings: AppSettings): Promise<MexcBalance[]> {
    const data = await this.privateRequest(this.baseSpotUrl, "/api/v3/account", "GET", settings);
    return (data.balances || [])
      .map((b: any) => ({
        asset: b.asset,
        available: parseFloat(b.free),
        frozen: parseFloat(b.locked),
        total: parseFloat(b.free) + parseFloat(b.locked)
      }))
      .filter((b: any) => b.total > 0.00001);
  }

  async getFuturesBalance(settings: AppSettings): Promise<MexcBalance[]> {
    const result = await this.privateRequest(this.baseFuturesUrl, "/futures/api/v1/private/account/assets", "GET", settings);
    if (!result.data) return [];
    return result.data.map((b: any) => ({
      asset: b.currency,
      available: b.availableBalance,
      frozen: b.frozenBalance,
      total: b.balance
    }));
  }

  async getOpenPositions(settings: AppSettings): Promise<Position[]> {
    const result = await this.privateRequest(this.baseFuturesUrl, "/futures/api/v1/private/position/open_details", "GET", settings);
    if (!result.data) return [];
    return result.data.map((p: any) => ({
      id: p.positionId || Math.random().toString(),
      symbol: p.symbol,
      side: p.positionType === 1 ? PositionSide.LONG : PositionSide.SHORT,
      entryPrice: p.holdAvgPrice,
      currentPrice: p.fairPrice,
      leverage: p.leverage,
      pnl: p.unrealizedPnl,
      pnlPercent: (p.unrealizedPnl / p.margin) * 100,
      margin: p.margin,
      liquidationPrice: p.liquidatePrice
    }));
  }

  async getOpenOrders(settings: AppSettings): Promise<MexcOrder[]> {
    const result = await this.privateRequest(this.baseFuturesUrl, "/futures/api/v1/private/order/list/open_orders", "GET", settings);
    if (!result.data) return [];
    return result.data.map((o: any) => ({
      orderId: o.orderId,
      symbol: o.symbol,
      price: o.price,
      quantity: o.vol,
      side: o.side === 1 ? "BUY" : "SELL",
      type: o.type === 1 ? "LIMIT" : "MARKET",
      status: "OPEN",
      createTime: o.createTime
    }));
  }

  async getTradeHistory(settings: AppSettings): Promise<MexcTrade[]> {
    const result = await this.privateRequest(this.baseFuturesUrl, "/futures/api/v1/private/order/list/history_orders", "GET", settings, { states: "3,4" });
    if (!result.data) return [];
    return result.data.map((t: any) => ({
      id: t.orderId,
      symbol: t.symbol,
      price: t.avgPrice,
      quantity: t.vol,
      side: t.side === 1 ? "BUY" : "SELL",
      pnl: t.realisedPnl || 0,
      time: t.updateTime
    }));
  }

  async getTransferHistory(settings: AppSettings): Promise<MexcTransfer[]> {
    try {
      const result = await this.privateRequest(this.baseSpotUrl, "/api/v3/capital/deposit/hisrec", "GET", settings);
      if (!Array.isArray(result)) return [];
      return result.map((t: any) => ({
        id: t.id || Math.random().toString(),
        asset: t.coin,
        amount: parseFloat(t.amount),
        type: "DEPOSIT",
        status: t.status === 1 ? "SUCCESS" : "PENDING",
        timestamp: t.insertTime
      }));
    } catch (e) {
      return [];
    }
  }

  async executeTrade(action: 'LONG' | 'SHORT' | 'CLOSE', settings: AppSettings, marketPrice: number) {
    if (!settings.isLiveMode) {
      return {
        id: "sim-" + Math.random().toString(36).substring(7),
        symbol: settings.tradingSymbol,
        side: action === 'LONG' ? PositionSide.LONG : PositionSide.SHORT,
        entryPrice: marketPrice,
        currentPrice: marketPrice,
        leverage: settings.defaultLeverage,
        pnl: 0,
        pnlPercent: 0,
        margin: 100 
      };
    }

    const side = action === 'LONG' ? 1 : (action === 'SHORT' ? 2 : 3);
    const orderParams = {
      symbol: settings.tradingSymbol,
      vol: 1, 
      side: side,
      type: 5, // Market
      openType: 1, // Isolated
      leverage: settings.defaultLeverage
    };

    return await this.privateRequest(this.baseFuturesUrl, "/futures/api/v1/private/order/create", "POST", settings, orderParams);
  }
}
