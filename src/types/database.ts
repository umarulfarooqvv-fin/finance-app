/* AUTO-GENERATED — do not edit by hand.
 *
 * Produced by scripts/gen-db-types.mjs from the live PostgREST schema.
 * Regenerate with:  npm run gen:types
 * Generated: 2026-08-22
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string; // primary key
          value: string | null;
        };
        Insert: {
          key: string;
          value?: string | null;
        };
        Update: {
          key?: string;
          value?: string | null;
        };
      };
      app_state: {
        Row: {
          key: string; // primary key
          value: number | null;
        };
        Insert: {
          key: string;
          value?: number | null;
        };
        Update: {
          key?: string;
          value?: number | null;
        };
      };
      events: {
        Row: {
          id: number; // primary key
          at: string | null;
          type: string | null;
          detail: string | null;
        };
        Insert: {
          id?: number;
          at?: string | null;
          type?: string | null;
          detail?: string | null;
        };
        Update: {
          id?: number;
          at?: string | null;
          type?: string | null;
          detail?: string | null;
        };
      };
      income: {
        Row: {
          id: string; // primary key
          ts: string | null;
          amount: number | null;
          source: string | null;
          account: string | null;
          remarks: string | null;
          needs_review: boolean | null;
          deleted: boolean | null;
          created_at: string | null;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          id: string;
          ts?: string | null;
          amount?: number | null;
          source?: string | null;
          account?: string | null;
          remarks?: string | null;
          needs_review?: boolean | null;
          deleted?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          ts?: string | null;
          amount?: number | null;
          source?: string | null;
          account?: string | null;
          remarks?: string | null;
          needs_review?: boolean | null;
          deleted?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
      };
      transactions: {
        Row: {
          id: string; // primary key
          ts: string | null;
          amount: number | null;
          method: string | null;
          category: string | null;
          remarks: string | null;
          kind: string | null;
          card_affected: string | null;
          card_direction: string | null;
          tags: Json | null;
          verified: boolean | null;
          needs_review: boolean | null;
          deleted: boolean | null;
          source: string | null;
          created_at: string | null;
          updated_at: string | null;
          updated_by: string | null;
        };
        Insert: {
          id: string;
          ts?: string | null;
          amount?: number | null;
          method?: string | null;
          category?: string | null;
          remarks?: string | null;
          kind?: string | null;
          card_affected?: string | null;
          card_direction?: string | null;
          tags?: Json | null;
          verified?: boolean | null;
          needs_review?: boolean | null;
          deleted?: boolean | null;
          source?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          ts?: string | null;
          amount?: number | null;
          method?: string | null;
          category?: string | null;
          remarks?: string | null;
          kind?: string | null;
          card_affected?: string | null;
          card_direction?: string | null;
          tags?: Json | null;
          verified?: boolean | null;
          needs_review?: boolean | null;
          deleted?: boolean | null;
          source?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
        };
      };
    };
  };
};

/** Row shapes, by table. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
