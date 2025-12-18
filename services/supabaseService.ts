
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { AppSettings, TradingLog } from '../types.ts';

export class SupabaseService {
  private client: SupabaseClient | null = null;

  init(url: string, key: string) {
    if (url && key) {
      this.client = createClient(url, key);
    }
  }

  async checkConnection(): Promise<boolean> {
    if (!this.client) return false;
    try {
      // Try to fetch one row to see if table exists and connection is valid
      const { error } = await this.client.from('aegis_settings').select('key').limit(1);
      return !error;
    } catch (e) {
      return false;
    }
  }

  async saveSettings(settings: AppSettings) {
    if (!this.client) throw new Error("Supabase client not initialized");
    const { error } = await this.client
      .from('aegis_settings')
      .upsert({ key: 'app_config', value: JSON.stringify(settings) }, { onConflict: 'key' });
    
    if (error) {
      console.error("Supabase Save Error:", error);
      throw new Error(error.message);
    }
    return true;
  }

  async loadSettings(): Promise<AppSettings | null> {
    if (!this.client) return null;
    try {
      const { data, error } = await this.client
        .from('aegis_settings')
        .select('value')
        .eq('key', 'app_config')
        .single();
      
      if (error || !data) return null;
      return JSON.parse(data.value);
    } catch (e) {
      return null;
    }
  }

  async logEvent(log: TradingLog) {
    if (!this.client) return;
    try {
      await this.client.from('aegis_logs').insert([{
        type: log.type,
        message: log.message,
        timestamp: new Date().toISOString()
      }]);
    } catch (e) {}
  }
}

export const supabaseService = new SupabaseService();
