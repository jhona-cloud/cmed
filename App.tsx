
import React, { useState, useEffect, useCallback } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { 
  AppSettings, MarketData, Position, PositionSide, TradingLog, TradeAction, AIProvider, MexcBalance, MexcOrder, MexcTransfer, MexcTrade
} from './types.ts';
import { MexcService } from './services/mexcService.ts';
import { AIService } from './services/aiService.ts';
import { supabaseService } from './services/supabaseService.ts';

const mexc = new MexcService();
const aiService = new AIService();

const STORAGE_KEY = 'aegis_ai_settings_v10';

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  // --- SETTINGS ---
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load local settings", e);
    }
    return {
      aiProvider: 'gemini',
      geminiApiKey: '',
      openaiApiKey: '',
      deepseekApiKey: '',
      mexcApiKey: '',
      mexcSecretKey: '',
      tradingSymbol: 'BTCUSDT',
      defaultLeverage: 10,
      riskPercent: 2,
      isAutoTrading: false,
      intervalMinutes: 1,
      isLiveMode: false,
      corsProxyUrl: '',
      supabaseUrl: 'https://xtvgmcmrjsbacqbkhhad.supabase.co',
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dmdtY21yanNiYWNxYmtoaGFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5OTIxMDUsImV4cCI6MjA4MTU2ODEwNX0.idsjIrSDNmn5CmukBhHU3zhJcLJ7ye4RH9mcijfDWaU'
    };
  });

  // --- STATE ---
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [spotBalances, setSpotBalances] = useState<MexcBalance[]>([]);
  const [futuresBalances, setFuturesBalances] = useState<MexcBalance[]>([]);
  const [mexcPositions, setMexcPositions] = useState<Position[]>([]);
  const [mexcOrders, setMexcOrders] = useState<MexcOrder[]>([]);
  const [mexcTrades, setMexcTrades] = useState<MexcTrade[]>([]);
  const [mexcTransfers, setMexcTransfers] = useState<MexcTransfer[]>([]);
  
  const [logs, setLogs] = useState<TradingLog[]>([]);
  const [lastAction, setLastAction] = useState<TradeAction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [view, setView] = useState<'DASHBOARD' | 'PORTFOLIO' | 'SETTINGS' | 'CLOUD' | 'LOGS'>('DASHBOARD');
  const [accountSubView, setAccountSubView] = useState<'BALANCES' | 'POSITIONS' | 'ORDERS' | 'HISTORY'>('BALANCES');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Status HUD State
  const [mexcStatus, setMexcStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');
  const [supabaseStatus, setSupabaseStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');

  // --- HELPERS ---
  const addLog = useCallback(async (type: TradingLog['type'], message: string) => {
    const newLog: TradingLog = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    setLogs(prev => [newLog, ...prev].slice(0, 100));
    try {
      await supabaseService.logEvent(newLog);
    } catch (e) {}
  }, []);

  const handleSave = useCallback(async (customSettings?: AppSettings) => {
    const toSave = customSettings || settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    supabaseService.init(toSave.supabaseUrl, toSave.supabaseAnonKey);
    
    try {
      await supabaseService.saveSettings(toSave);
      setSaveStatus('Saved to Cloud');
      addLog('SUCCESS', 'Configuration synchronized with Supabase.');
      setSupabaseStatus('CONNECTED');
    } catch (e: any) {
      setSaveStatus('Local Save Only');
      addLog('ERROR', `Cloud sync failed: ${e.message}`);
      setSupabaseStatus('ERROR');
    }
    setTimeout(() => setSaveStatus(null), 3000);
  }, [settings, addLog]);

  const fetchFromCloud = useCallback(async () => {
    try {
      supabaseService.init(settings.supabaseUrl, settings.supabaseAnonKey);
      const cloudSettings = await supabaseService.loadSettings();
      if (cloudSettings) {
        setSettings(cloudSettings);
        addLog('SUCCESS', 'Restored configuration from cloud.');
        setSupabaseStatus('CONNECTED');
        return cloudSettings;
      }
      setSupabaseStatus('DISCONNECTED');
    } catch (e) {
      setSupabaseStatus('ERROR');
    }
    return null;
  }, [settings.supabaseUrl, settings.supabaseAnonKey, addLog]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginForm.username === 'admin' && loginForm.password === '666666') {
      setIsLoggedIn(true);
      setLoginError('');
      await fetchFromCloud();
    } else {
      setLoginError('Invalid credentials.');
    }
  };

  const autoFixProxy = (option: 'HEROKU' | 'THING') => {
    const proxyUrl = option === 'HEROKU' ? "https://cors-anywhere.herokuapp.com/" : "https://thingproxy.freeboard.io/fetch/";
    const newSettings = { ...settings, corsProxyUrl: proxyUrl };
    setSettings(newSettings);
    addLog('INFO', `Proxy applied: ${option}`);
    handleSave(newSettings);
  };

  const refreshMarket = useCallback(async () => {
    try {
      const ticker = await mexc.getTicker(settings.tradingSymbol);
      const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setMarketData(prev => {
        const history = prev?.history ? [...prev.history] : [];
        const newHistory = [...history, { time: currentTime, price: ticker.price }].slice(-50);
        return { ...ticker, history: newHistory };
      });
      if (isLoading) setIsLoading(false);
    } catch (err) {
      if (isLoading) setIsLoading(false);
    }
  }, [settings.tradingSymbol, isLoading]);

  const refreshAccountData = useCallback(async () => {
    if (!settings.mexcApiKey || !settings.mexcSecretKey || !isLoggedIn) {
      setMexcStatus('DISCONNECTED');
      return;
    }
    try {
      const [spot, futures, positions, orders, trades, transfers] = await Promise.all([
        mexc.getSpotBalance(settings),
        mexc.getFuturesBalance(settings),
        mexc.getOpenPositions(settings),
        mexc.getOpenOrders(settings),
        mexc.getTradeHistory(settings),
        mexc.getTransferHistory(settings)
      ]);
      setSpotBalances(spot);
      setFuturesBalances(futures);
      setMexcPositions(positions);
      setMexcOrders(orders);
      setMexcTrades(trades);
      setMexcTransfers(transfers);
      setMexcStatus('CONNECTED');
    } catch (e: any) {
      addLog('ERROR', `MEXC sync error: ${e.message}`);
      setMexcStatus('ERROR');
    }
  }, [settings, isLoggedIn, addLog]);

  const runTradingCycle = useCallback(async () => {
    if (!settings.isAutoTrading || !marketData) return;
    try {
      setIsAnalyzing(true);
      const activeSide = mexcPositions.length > 0 ? mexcPositions[0].side : PositionSide.NONE;
      const decision = await aiService.analyze(settings, marketData, activeSide);
      setLastAction(decision);
      if (decision.action !== 'WAIT') {
        addLog('TRADE', `AI decision: ${decision.action} (${decision.confidence}%)`);
        if (settings.isLiveMode) {
           await mexc.executeTrade(decision.action, settings, marketData.price);
           refreshAccountData();
        }
      }
      setIsAnalyzing(false);
    } catch (err) {
      addLog('ERROR', `AI analysis failed: ${err instanceof Error ? err.message : 'Unknown'}`);
      setIsAnalyzing(false);
    }
  }, [settings, mexcPositions, marketData, addLog, refreshAccountData]);

  useEffect(() => {
    supabaseService.init(settings.supabaseUrl, settings.supabaseAnonKey);
    refreshMarket();
    const interval = setInterval(refreshMarket, 5000);
    return () => clearInterval(interval);
  }, [refreshMarket]);

  useEffect(() => {
    if (isLoggedIn) {
      refreshAccountData();
      const interval = setInterval(refreshAccountData, 20000);
      return () => clearInterval(interval);
    }
  }, [refreshAccountData, isLoggedIn]);

  useEffect(() => {
    let interval: number;
    if (settings.isAutoTrading) {
      runTradingCycle();
      interval = window.setInterval(runTradingCycle, settings.intervalMinutes * 60000);
    }
    return () => clearInterval(interval);
  }, [settings.isAutoTrading, settings.intervalMinutes, runTradingCycle]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
        <div className="bg-[#161b22] border border-[#30363d] p-8 rounded-xl w-full max-w-md shadow-lg">
          <div className="text-center mb-8">
            <i className="fas fa-shield-halved text-4xl text-blue-500 mb-4"></i>
            <h1 className="text-2xl font-bold text-white">Aegis AI Login</h1>
            <p className="text-gray-500 text-sm mt-1">Enter credentials to access the terminal</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Username</label>
              <input 
                type="text" 
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none transition-all"
                value={loginForm.username}
                onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">Password</label>
              <input 
                type="password" 
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white focus:border-blue-500 outline-none transition-all"
                value={loginForm.password}
                onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
              />
            </div>
            {loginError && <p className="text-red-500 text-xs text-center">{loginError}</p>}
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg shadow-blue-900/20">Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen bg-[#0d1117] flex flex-col items-center justify-center text-white">
        <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-medium text-gray-400">Loading Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0d1117] text-[#c9d1d9] font-sans selection:bg-blue-500/30">
      {/* Sidebar */}
      <aside className="w-64 bg-[#161b22] border-r border-[#30363d] flex flex-col shrink-0">
        <div className="p-6 flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20">
            <i className="fas fa-bolt text-white text-sm"></i>
          </div>
          <span className="text-lg font-bold text-white tracking-tight">AEGIS <span className="text-blue-500">TRADER</span></span>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {[
            { id: 'DASHBOARD', icon: 'fa-chart-pie', label: 'Overview' },
            { id: 'PORTFOLIO', icon: 'fa-wallet', label: 'Portfolio' },
            { id: 'SETTINGS', icon: 'fa-sliders', label: 'Bot Config' },
            { id: 'CLOUD', icon: 'fa-cloud', label: 'Sync Status' },
            { id: 'LOGS', icon: 'fa-list', label: 'Activity Logs' }
          ].map(item => (
            <button 
              key={item.id}
              onClick={() => setView(item.id as any)}
              className={`w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-all text-sm font-medium ${view === item.id ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:bg-[#30363d]/30 hover:text-white'}`}
            >
              <i className={`fas ${item.icon} w-5`}></i>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-[#30363d]">
          <div className={`p-4 rounded-lg border ${settings.isAutoTrading ? 'bg-green-500/5 border-green-500/20' : 'bg-[#0d1117] border-[#30363d]'}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-500 uppercase">Auto Mode</span>
              <div className={`w-2 h-2 rounded-full ${settings.isAutoTrading ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            </div>
            <button 
              onClick={() => {
                const updated = { ...settings, isAutoTrading: !settings.isAutoTrading };
                setSettings(updated);
                handleSave(updated);
              }}
              className={`w-full py-2 rounded-md text-xs font-bold transition-all ${settings.isAutoTrading ? 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              {settings.isAutoTrading ? 'Stop Bot' : 'Start Bot'}
            </button>
          </div>
          <button onClick={() => setIsLoggedIn(false)} className="w-full mt-4 text-xs font-medium text-gray-500 hover:text-red-400 transition-colors">Sign Out</button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0d1117]">
        {/* Header */}
        <header className="h-16 border-b border-[#30363d] flex items-center justify-between px-8 bg-[#0d1117]/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-bold text-white tracking-tight">{view.charAt(0) + view.slice(1).toLowerCase()}</h2>
            <div className="flex items-center space-x-3">
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${supabaseStatus === 'CONNECTED' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>Cloud: {supabaseStatus}</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${mexcStatus === 'CONNECTED' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>MEXC: {mexcStatus}</span>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Index Price</p>
              <p className="text-lg font-bold text-white font-mono">${marketData?.price.toLocaleString() || '0.00'}</p>
            </div>
            <div className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase ${settings.isLiveMode ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'}`}>
              {settings.isLiveMode ? 'Live Mode' : 'Simulation'}
            </div>
          </div>
        </header>

        {/* View Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {view === 'DASHBOARD' && (
            <div className="grid grid-cols-12 gap-8 max-w-7xl">
              {/* Chart Card */}
              <div className="col-span-12 lg:col-span-8 bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Price Momentum ({settings.tradingSymbol})</h3>
                  <div className="flex items-center space-x-2">
                    <span className={`text-xs font-bold ${marketData?.change24h && marketData.change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {marketData?.change24h && marketData.change24h >= 0 ? '+' : ''}{marketData?.change24h}%
                    </span>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={marketData?.history || []}>
                      <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#30363d" opacity={0.3} />
                      <XAxis dataKey="time" hide />
                      <YAxis domain={['auto', 'auto']} hide />
                      <Tooltip contentStyle={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', color: '#fff' }} />
                      <Area type="monotone" dataKey="price" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPrice)" strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* AI Insight Card */}
              <div className="col-span-12 lg:col-span-4 flex flex-col space-y-8">
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-sm flex-1">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">AI Signal</h3>
                    {isAnalyzing && <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>}
                  </div>
                  {!lastAction ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-12">
                      <i className="fas fa-robot text-3xl text-[#30363d] mb-3"></i>
                      <p className="text-xs text-gray-500">Awaiting market signal...</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className={`p-4 rounded-lg text-center border ${
                        lastAction.action === 'LONG' ? 'bg-green-500/10 border-green-500/20 text-green-500' :
                        lastAction.action === 'SHORT' ? 'bg-red-500/10 border-red-500/20 text-red-500' : 
                        'bg-gray-800/50 border-gray-700 text-gray-400'
                      }`}>
                        <p className="text-2xl font-black uppercase tracking-tight">{lastAction.action}</p>
                        <p className="text-[10px] font-bold opacity-60 mt-1 uppercase">Confidence: {lastAction.confidence}%</p>
                      </div>
                      <div className="bg-[#0d1117] p-4 rounded-lg border border-[#30363d]">
                        <p className="text-xs text-gray-400 leading-relaxed italic">"{lastAction.reason}"</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Info */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-sm">
                  <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Active Vectors</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500">Symbol</span>
                      <span className="text-white font-bold">{settings.tradingSymbol}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500">Leverage</span>
                      <span className="text-white font-bold">{settings.defaultLeverage}x</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500">Pulse</span>
                      <span className="text-white font-bold">{settings.intervalMinutes}m</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'PORTFOLIO' && (
            <div className="max-w-7xl space-y-6">
              <div className="flex space-x-2 border-b border-[#30363d] mb-8">
                {(['BALANCES', 'POSITIONS', 'ORDERS', 'HISTORY'] as const).map(tab => (
                  <button 
                    key={tab} 
                    onClick={() => setAccountSubView(tab)}
                    className={`px-6 py-3 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${accountSubView === tab ? 'border-blue-500 text-blue-500' : 'border-transparent text-gray-500 hover:text-white'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {accountSubView === 'BALANCES' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-6 tracking-wider">Futures Account</h4>
                    <div className="space-y-4">
                      {futuresBalances.length > 0 ? futuresBalances.map(b => (
                        <div key={b.asset} className="flex justify-between items-center p-3 hover:bg-white/5 rounded-lg transition-colors">
                          <span className="font-bold text-white">{b.asset}</span>
                          <div className="text-right">
                            <span className="block text-sm font-bold text-white">{Number(b.total).toFixed(2)}</span>
                            <span className="block text-[10px] text-gray-500 uppercase">Available: {b.available}</span>
                          </div>
                        </div>
                      )) : (
                        <p className="text-xs text-gray-500 py-4 text-center">No futures balance found.</p>
                      )}
                    </div>
                  </div>
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
                    <h4 className="text-xs font-bold text-gray-400 uppercase mb-6 tracking-wider">Spot Wallet</h4>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {spotBalances.length > 0 ? spotBalances.map(b => (
                        <div key={b.asset} className="flex justify-between items-center p-2.5 hover:bg-white/5 rounded-lg transition-colors">
                          <span className="text-sm font-semibold text-gray-300">{b.asset}</span>
                          <span className="text-sm font-mono text-white">{Number(b.total).toFixed(4)}</span>
                        </div>
                      )) : (
                        <p className="text-xs text-gray-500 py-4 text-center">No spot balance found.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {accountSubView === 'POSITIONS' && (
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#0d1117] text-gray-500 text-[10px] font-bold uppercase tracking-widest border-b border-[#30363d]">
                      <tr>
                        <th className="px-6 py-4">Symbol</th>
                        <th className="px-6 py-4">Side</th>
                        <th className="px-6 py-4">Leverage</th>
                        <th className="px-6 py-4">Entry</th>
                        <th className="px-6 py-4">Current</th>
                        <th className="px-6 py-4">PnL (USDT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      {mexcPositions.map(pos => (
                        <tr key={pos.id} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 font-bold text-white">{pos.symbol}</td>
                          <td className={`px-6 py-4 font-bold ${pos.side === PositionSide.LONG ? 'text-green-500' : 'text-red-500'}`}>{pos.side}</td>
                          <td className="px-6 py-4 text-gray-300">{pos.leverage}x</td>
                          <td className="px-6 py-4 font-mono text-xs">{pos.entryPrice}</td>
                          <td className="px-6 py-4 font-mono text-xs">{pos.currentPrice}</td>
                          <td className={`px-6 py-4 font-bold ${pos.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {mexcPositions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-gray-500 italic">No active positions.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {view === 'SETTINGS' && (
            <div className="max-w-4xl space-y-8 pb-20">
              <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-8 shadow-sm">
                <div className="flex justify-between items-center mb-10">
                  <h3 className="text-xl font-bold text-white tracking-tight">Bot Configuration</h3>
                  <div className="flex items-center space-x-4">
                    {saveStatus && <span className="text-green-500 text-xs font-bold animate-pulse">{saveStatus}</span>}
                    <button onClick={() => handleSave()} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold text-xs transition-all shadow-lg shadow-blue-900/20">Save Changes</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2 tracking-widest">AI Intelligence</label>
                      <select 
                        value={settings.aiProvider}
                        onChange={e => setSettings(s => ({ ...s, aiProvider: e.target.value as AIProvider }))}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-all"
                      >
                        <option value="gemini">Gemini 3 Pro Prime</option>
                        <option value="openai">OpenAI GPT-4o Omni</option>
                        <option value="deepseek">DeepSeek V3 Neural</option>
                      </select>
                      <input 
                        type="password" 
                        placeholder="Neural Access Key" 
                        className="w-full mt-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white font-mono text-sm outline-none focus:border-blue-500"
                        value={settings.aiProvider === 'gemini' ? settings.geminiApiKey : settings.aiProvider === 'openai' ? settings.openaiApiKey : settings.deepseekApiKey} 
                        onChange={e => setSettings(s => ({ ...s, 
                          geminiApiKey: s.aiProvider === 'gemini' ? e.target.value : s.geminiApiKey,
                          openaiApiKey: s.aiProvider === 'openai' ? e.target.value : s.openaiApiKey,
                          deepseekApiKey: s.aiProvider === 'deepseek' ? e.target.value : s.deepseekApiKey
                        }))}
                      />
                    </div>

                    <div className="p-5 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                      <h4 className="text-[10px] font-bold text-blue-500 uppercase mb-3">CORS Proxy Fix</h4>
                      <div className="flex gap-2 mb-3">
                        <button onClick={() => autoFixProxy('HEROKU')} className="flex-1 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-[10px] font-bold uppercase hover:bg-blue-600 hover:border-blue-600 transition-all">Heroku</button>
                        <button onClick={() => autoFixProxy('THING')} className="flex-1 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-[10px] font-bold uppercase hover:bg-blue-600 hover:border-blue-600 transition-all">ThingProxy</button>
                      </div>
                      <input 
                        type="text" 
                        placeholder="Proxy URL" 
                        value={settings.corsProxyUrl}
                        onChange={e => setSettings(s => ({ ...s, corsProxyUrl: e.target.value }))}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-white font-mono text-[11px] outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2 tracking-widest">MEXC Integration</label>
                      <select value={settings.isLiveMode ? 'live' : 'sim'} onChange={e => setSettings(s => ({ ...s, isLiveMode: e.target.value === 'live' }))} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white text-sm outline-none">
                        <option value="sim">Simulation Mode</option>
                        <option value="live">Live Trading Mode</option>
                      </select>
                      <input type="password" placeholder="API Key" value={settings.mexcApiKey} onChange={e => setSettings(s => ({ ...s, mexcApiKey: e.target.value }))} className="w-full mt-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white font-mono text-sm outline-none" />
                      <input type="password" placeholder="Secret Key" value={settings.mexcSecretKey} onChange={e => setSettings(s => ({ ...s, mexcSecretKey: e.target.value }))} className="w-full mt-3 bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white font-mono text-sm outline-none" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">Symbol</label>
                          <input value={settings.tradingSymbol} onChange={e => setSettings(s => ({ ...s, tradingSymbol: e.target.value.toUpperCase() }))} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2 text-white font-bold text-center text-sm uppercase" />
                       </div>
                       <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2">Pulse (Min)</label>
                          <input type="number" min="1" value={settings.intervalMinutes} onChange={e => setSettings(s => ({ ...s, intervalMinutes: Math.max(1, parseInt(e.target.value) || 1) }))} className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2 text-white font-bold text-center text-sm" />
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'CLOUD' && (
            <div className="max-w-4xl space-y-8">
              <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-8 shadow-sm">
                <div className="flex justify-between items-center mb-8 pb-8 border-b border-[#30363d]">
                   <h3 className="text-xl font-bold text-white tracking-tight">Supabase Sync</h3>
                   <button onClick={fetchFromCloud} className="text-xs font-bold bg-blue-600/10 text-blue-500 border border-blue-500/20 px-4 py-2 rounded-lg hover:bg-blue-600 hover:text-white transition-all">Force Pull</button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                   <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2 tracking-widest">Gateway URL</label>
                      <input 
                        type="text" 
                        value={settings.supabaseUrl} 
                        onChange={e => setSettings(s => ({ ...s, supabaseUrl: e.target.value }))}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-3 text-white font-mono text-xs outline-none focus:border-blue-500" 
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-2 tracking-widest">Anon Key</label>
                      <input 
                        type="password" 
                        value={settings.supabaseAnonKey} 
                        onChange={e => setSettings(s => ({ ...s, supabaseAnonKey: e.target.value }))}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-3 text-white font-mono text-xs outline-none focus:border-blue-500" 
                      />
                   </div>
                </div>

                <div className="space-y-4">
                   <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Database Schema Required</h4>
                   <div className="relative group">
                      <pre className="bg-[#0d1117] border border-[#30363d] rounded-lg p-6 font-mono text-[11px] text-blue-400 overflow-x-auto leading-relaxed">
{`CREATE TABLE aegis_settings (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE aegis_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  type TEXT NOT NULL,
  message TEXT NOT NULL
);

ALTER TABLE aegis_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON aegis_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON aegis_logs FOR ALL USING (true) WITH CHECK (true);`}
                      </pre>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(`CREATE TABLE aegis_settings (id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()); CREATE TABLE aegis_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(), type TEXT NOT NULL, message TEXT NOT NULL); ALTER TABLE aegis_settings ENABLE ROW LEVEL SECURITY; CREATE POLICY "Allow all" ON aegis_settings FOR ALL USING (true) WITH CHECK (true); CREATE POLICY "Allow all" ON aegis_logs FOR ALL USING (true) WITH CHECK (true);`);
                          alert("SQL copied to clipboard.");
                        }}
                        className="absolute top-4 right-4 bg-[#30363d] text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase hover:bg-blue-600 transition-all"
                      >
                        Copy SQL
                      </button>
                   </div>
                </div>
              </div>
            </div>
          )}

          {view === 'LOGS' && (
            <div className="max-w-7xl h-[calc(100vh-200px)] bg-[#161b22] border border-[#30363d] rounded-xl flex flex-col overflow-hidden shadow-sm">
              <div className="px-8 py-4 border-b border-[#30363d] flex justify-between items-center bg-[#161b22]/50">
                <span className="text-xs font-bold text-blue-500 uppercase tracking-widest">Activity Stream</span>
                <button onClick={() => setLogs([])} className="text-[10px] text-gray-500 hover:text-red-400 font-bold uppercase transition-all">Clear Stream</button>
              </div>
              <div className="flex-1 overflow-y-auto px-8 py-6 font-mono text-[11px] space-y-3 custom-scrollbar">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-6 border-b border-white/5 pb-2 transition-all">
                    <span className="text-gray-600 shrink-0">[{log.timestamp}]</span>
                    <span className={`font-bold w-20 shrink-0 ${log.type === 'ERROR' ? 'text-red-500' : log.type === 'SUCCESS' ? 'text-green-500' : 'text-blue-500'}`}>{log.type}</span>
                    <span className="text-gray-400 flex-1">{log.message}</span>
                  </div>
                ))}
                {logs.length === 0 && <div className="text-center text-gray-700 py-32 text-xs italic">Terminal stream idle.</div>}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
