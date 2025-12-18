
export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
  NONE = 'NONE'
}

export type AIProvider = 'gemini' | 'openai' | 'deepseek';

export interface MarketData {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
  timestamp: number;
  history: { time: string; price: number }[];
}

export interface TradeAction {
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'WAIT';
  leverage: number;
  reason: string;
  confidence: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  pnl: number;
  pnlPercent: number;
  margin: number;
  unrealizedPnl?: number;
  liquidationPrice?: number;
}

export interface MexcBalance {
  asset: string;
  available: number;
  frozen: number;
  total: number;
}

export interface MexcOrder {
  orderId: string;
  symbol: string;
  price: number;
  quantity: number;
  side: string;
  type: string;
  status: string;
  createTime: number;
}

export interface MexcTrade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  side: string;
  pnl: number;
  time: number;
}

export interface MexcTransfer {
  id: string;
  asset: string;
  amount: number;
  type: string;
  status: string;
  timestamp: number;
}

export interface TradingLog {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'TRADE';
  message: string;
}

export interface AppSettings {
  aiProvider: AIProvider;
  geminiApiKey?: string;
  openaiApiKey?: string;
  deepseekApiKey?: string;
  mexcApiKey: string;
  mexcSecretKey: string;
  tradingSymbol: string;
  defaultLeverage: number;
  riskPercent: number;
  isAutoTrading: boolean;
  intervalMinutes: number;
  isLiveMode: boolean;
  corsProxyUrl?: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}
