export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          activity_day: string
          kind: string
          occurred_at: string
          user_id: string
        }
        Insert: {
          activity_day?: string
          kind: string
          occurred_at?: string
          user_id: string
        }
        Update: {
          activity_day?: string
          kind?: string
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "activity_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "activity_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "activity_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
        ]
      }
      activity_facts: {
        Row: {
          activity_type: string
          alliance_id: string | null
          confidence: number
          created_at: string
          event_instance_id: string | null
          fact_id: string
          idempotency_key: string
          measurement_type: Database["public"]["Enums"]["measurement_type"]
          metric_key: string
          occurred_at: string
          player_id: string | null
          schema_version: number
          season_instance_id: string | null
          source_snapshot_id: string | null
          source_type: string
          unit: string
          value_numeric: number
        }
        Insert: {
          activity_type: string
          alliance_id?: string | null
          confidence?: number
          created_at?: string
          event_instance_id?: string | null
          fact_id?: string
          idempotency_key: string
          measurement_type: Database["public"]["Enums"]["measurement_type"]
          metric_key: string
          occurred_at: string
          player_id?: string | null
          schema_version?: number
          season_instance_id?: string | null
          source_snapshot_id?: string | null
          source_type: string
          unit: string
          value_numeric: number
        }
        Update: {
          activity_type?: string
          alliance_id?: string | null
          confidence?: number
          created_at?: string
          event_instance_id?: string | null
          fact_id?: string
          idempotency_key?: string
          measurement_type?: Database["public"]["Enums"]["measurement_type"]
          metric_key?: string
          occurred_at?: string
          player_id?: string | null
          schema_version?: number
          season_instance_id?: string | null
          source_snapshot_id?: string | null
          source_type?: string
          unit?: string
          value_numeric?: number
        }
        Relationships: [
          {
            foreignKeyName: "activity_facts_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "activity_facts_metric_key_fkey"
            columns: ["metric_key"]
            isOneToOne: false
            referencedRelation: "metric_registry"
            referencedColumns: ["metric_key"]
          },
          {
            foreignKeyName: "activity_facts_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      alliance_contribution_snapshots: {
        Row: {
          alliance_code: string | null
          alliance_id: string | null
          alliance_name: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          contribution_type: string
          created_at: string
          game_uid: number
          idempotency_key: string
          observation_id: string
          parser_version: string
          player_id: string | null
          rank: number | null
          raw: Json
          score: number | null
          score_updated_at: string | null
          server_id: number
          snapshot_id: string
          source_command: string
          variant: number | null
        }
        Insert: {
          alliance_code?: string | null
          alliance_id?: string | null
          alliance_name?: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          contribution_type: string
          created_at?: string
          game_uid: number
          idempotency_key: string
          observation_id: string
          parser_version: string
          player_id?: string | null
          rank?: number | null
          raw?: Json
          score?: number | null
          score_updated_at?: string | null
          server_id: number
          snapshot_id?: string
          source_command: string
          variant?: number | null
        }
        Update: {
          alliance_code?: string | null
          alliance_id?: string | null
          alliance_name?: string | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          contribution_type?: string
          created_at?: string
          game_uid?: number
          idempotency_key?: string
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          rank?: number | null
          raw?: Json
          score?: number | null
          score_updated_at?: string | null
          server_id?: number
          snapshot_id?: string
          source_command?: string
          variant?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_contribution_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_contribution_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "alliance_contribution_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "alliance_contribution_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "alliance_contribution_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_growth_current: {
        Row: {
          alliance_id: string
          code: string | null
          cross_rank_climb: number | null
          cross_rank_first: number | null
          cross_rank_last: number | null
          first_at: string | null
          is_own: boolean | null
          last_at: string | null
          member_count: number | null
          name: string | null
          power_first: number | null
          power_growth: number | null
          power_growth_pct: number | null
          power_last: number | null
          rank_climb: number | null
          rank_first: number | null
          rank_last: number | null
          readings: number | null
          refreshed_at: string
          server_id: number | null
          span_days: number | null
        }
        Insert: {
          alliance_id: string
          code?: string | null
          cross_rank_climb?: number | null
          cross_rank_first?: number | null
          cross_rank_last?: number | null
          first_at?: string | null
          is_own?: boolean | null
          last_at?: string | null
          member_count?: number | null
          name?: string | null
          power_first?: number | null
          power_growth?: number | null
          power_growth_pct?: number | null
          power_last?: number | null
          rank_climb?: number | null
          rank_first?: number | null
          rank_last?: number | null
          readings?: number | null
          refreshed_at?: string
          server_id?: number | null
          span_days?: number | null
        }
        Update: {
          alliance_id?: string
          code?: string | null
          cross_rank_climb?: number | null
          cross_rank_first?: number | null
          cross_rank_last?: number | null
          first_at?: string | null
          is_own?: boolean | null
          last_at?: string | null
          member_count?: number | null
          name?: string | null
          power_first?: number | null
          power_growth?: number | null
          power_growth_pct?: number | null
          power_last?: number | null
          rank_climb?: number | null
          rank_first?: number | null
          rank_last?: number | null
          readings?: number | null
          refreshed_at?: string
          server_id?: number | null
          span_days?: number | null
        }
        Relationships: []
      }
      alliance_latest_current: {
        Row: {
          alliance_id: string | null
          captured_at: string | null
          code: string | null
          external_id: string
          member_count: number | null
          name: string | null
          power: number | null
          rank: number | null
          refreshed_at: string
          server_id: number | null
          snapshot_id: string
        }
        Insert: {
          alliance_id?: string | null
          captured_at?: string | null
          code?: string | null
          external_id: string
          member_count?: number | null
          name?: string | null
          power?: number | null
          rank?: number | null
          refreshed_at?: string
          server_id?: number | null
          snapshot_id: string
        }
        Update: {
          alliance_id?: string | null
          captured_at?: string | null
          code?: string | null
          external_id?: string
          member_count?: number | null
          name?: string | null
          power?: number | null
          rank?: number | null
          refreshed_at?: string
          server_id?: number | null
          snapshot_id?: string
        }
        Relationships: []
      }
      alliance_member_snapshots: {
        Row: {
          alliance_id: string
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          hq_level: number | null
          idempotency_key: string
          kills: number | null
          member_rank: number | null
          month_card_expires_at: string | null
          name: string | null
          observation_id: string
          offline_since: string | null
          online_state: string | null
          parser_version: string
          player_id: string | null
          power: number | null
          presence_redacted: boolean
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_id: string
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          hq_level?: number | null
          idempotency_key: string
          kills?: number | null
          member_rank?: number | null
          month_card_expires_at?: string | null
          name?: string | null
          observation_id: string
          offline_since?: string | null
          online_state?: string | null
          parser_version: string
          player_id?: string | null
          power?: number | null
          presence_redacted?: boolean
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_id?: string
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          hq_level?: number | null
          idempotency_key?: string
          kills?: number | null
          member_rank?: number | null
          month_card_expires_at?: string | null
          name?: string | null
          observation_id?: string
          offline_since?: string | null
          online_state?: string | null
          parser_version?: string
          player_id?: string | null
          power?: number | null
          presence_redacted?: boolean
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_names: {
        Row: {
          alliance_id: string
          alliance_name_id: string
          code: string | null
          first_seen_at: string
          last_seen_at: string
          name: string
        }
        Insert: {
          alliance_id: string
          alliance_name_id?: string
          code?: string | null
          first_seen_at: string
          last_seen_at: string
          name: string
        }
        Update: {
          alliance_id?: string
          alliance_name_id?: string
          code?: string | null
          first_seen_at?: string
          last_seen_at?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliance_names_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
        ]
      }
      alliance_season_score_snapshots: {
        Row: {
          alliance_abbr: string | null
          alliance_external_id: string
          alliance_id: string | null
          alliance_name: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          country: string | null
          created_at: string
          idempotency_key: string
          leader_name: string | null
          observation_id: string
          parser_version: string
          power: number | null
          previous_rank: number | null
          rank: number | null
          raw: Json
          score: number | null
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_abbr?: string | null
          alliance_external_id: string
          alliance_id?: string | null
          alliance_name?: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          country?: string | null
          created_at?: string
          idempotency_key: string
          leader_name?: string | null
          observation_id: string
          parser_version: string
          power?: number | null
          previous_rank?: number | null
          rank?: number | null
          raw?: Json
          score?: number | null
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_abbr?: string | null
          alliance_external_id?: string
          alliance_id?: string | null
          alliance_name?: string | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          country?: string | null
          created_at?: string
          idempotency_key?: string
          leader_name?: string | null
          observation_id?: string
          parser_version?: string
          power?: number | null
          previous_rank?: number | null
          rank?: number | null
          raw?: Json
          score?: number | null
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliance_season_score_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_season_score_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "alliance_season_score_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "alliance_season_score_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_snapshots: {
        Row: {
          alliance_id: string
          captured_at: string
          code: string | null
          collected_from_server_id: number
          collector_id: string
          created_at: string
          external_id: string
          idempotency_key: string
          leader_game_uid: number | null
          member_count: number | null
          name: string | null
          observation_id: string
          parser_version: string
          power: number | null
          rank: number | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_id: string
          captured_at: string
          code?: string | null
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          external_id: string
          idempotency_key: string
          leader_game_uid?: number | null
          member_count?: number | null
          name?: string | null
          observation_id: string
          parser_version: string
          power?: number | null
          rank?: number | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_id?: string
          captured_at?: string
          code?: string | null
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          external_id?: string
          idempotency_key?: string
          leader_game_uid?: number | null
          member_count?: number | null
          name?: string | null
          observation_id?: string
          parser_version?: string
          power?: number | null
          rank?: number | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliance_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "alliance_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "alliance_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliances: {
        Row: {
          alliance_id: string
          created_at: string
          current_code: string | null
          current_name: string | null
          external_id: string
          first_seen_at: string
          is_own: boolean
          last_seen_at: string | null
          leader_player_id: string | null
          member_count: number | null
          power: number | null
          roster_unredacted_seen: boolean
          server_id: number
          updated_at: string
        }
        Insert: {
          alliance_id?: string
          created_at?: string
          current_code?: string | null
          current_name?: string | null
          external_id: string
          first_seen_at?: string
          is_own?: boolean
          last_seen_at?: string | null
          leader_player_id?: string | null
          member_count?: number | null
          power?: number | null
          roster_unredacted_seen?: boolean
          server_id: number
          updated_at?: string
        }
        Update: {
          alliance_id?: string
          created_at?: string
          current_code?: string | null
          current_name?: string | null
          external_id?: string
          first_seen_at?: string
          is_own?: boolean
          last_seen_at?: string | null
          leader_player_id?: string | null
          member_count?: number | null
          power?: number | null
          roster_unredacted_seen?: boolean
          server_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliances_leader_player_id_fkey"
            columns: ["leader_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "alliances_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      announcements: {
        Row: {
          announcement_id: string
          body: string
          channels: string[] | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          pinned: boolean
          published_at: string | null
          starts_at: string | null
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          announcement_id?: string
          body?: string
          channels?: string[] | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          pinned?: boolean
          published_at?: string | null
          starts_at?: string | null
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          announcement_id?: string
          body?: string
          channels?: string[] | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          pinned?: boolean
          published_at?: string | null
          starts_at?: string | null
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      app_users: {
        Row: {
          created_at: string
          display_name: string | null
          game_rank: string | null
          player_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          game_rank?: string | null
          player_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          game_rank?: string | null
          player_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "app_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      arena_entries: {
        Row: {
          alliance_code: string | null
          alliance_name: string | null
          arena_snapshot_id: string
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          defense_power: number | null
          game_uid: number
          idempotency_key: string
          name: string | null
          observation_id: string
          parser_version: string
          player_id: string | null
          rank: number
          raw: Json
          score: number | null
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_code?: string | null
          alliance_name?: string | null
          arena_snapshot_id: string
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          defense_power?: number | null
          game_uid: number
          idempotency_key: string
          name?: string | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          rank: number
          raw?: Json
          score?: number | null
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_code?: string | null
          alliance_name?: string | null
          arena_snapshot_id?: string
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          defense_power?: number | null
          game_uid?: number
          idempotency_key?: string
          name?: string | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          rank?: number
          raw?: Json
          score?: number | null
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "arena_entries_arena_snapshot_id_fkey"
            columns: ["arena_snapshot_id"]
            isOneToOne: false
            referencedRelation: "arena_snapshots"
            referencedColumns: ["snapshot_id"]
          },
          {
            foreignKeyName: "arena_entries_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "arena_entries_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "arena_entries_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "arena_entries_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      arena_entry_heroes: {
        Row: {
          arena_entry_id: string
          base_level: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          equipment: Json
          game_uid: number
          hero_id: number
          hero_level: number | null
          hero_power: number | null
          hero_uuid: number | null
          idempotency_key: string
          level_synced: boolean
          max_level: number | null
          observation_id: string
          parser_version: string
          player_id: string | null
          raw: Json
          server_id: number
          skills: Json
          slot: number | null
          snapshot_id: string
          source_command: string
          stage: number | null
          star: number | null
          troop_class: number | null
          troop_count: number | null
          troop_type_id: string | null
          weapon_level: number | null
        }
        Insert: {
          arena_entry_id: string
          base_level?: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          equipment?: Json
          game_uid: number
          hero_id: number
          hero_level?: number | null
          hero_power?: number | null
          hero_uuid?: number | null
          idempotency_key: string
          level_synced?: boolean
          max_level?: number | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          raw?: Json
          server_id: number
          skills?: Json
          slot?: number | null
          snapshot_id?: string
          source_command: string
          stage?: number | null
          star?: number | null
          troop_class?: number | null
          troop_count?: number | null
          troop_type_id?: string | null
          weapon_level?: number | null
        }
        Update: {
          arena_entry_id?: string
          base_level?: number | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          equipment?: Json
          game_uid?: number
          hero_id?: number
          hero_level?: number | null
          hero_power?: number | null
          hero_uuid?: number | null
          idempotency_key?: string
          level_synced?: boolean
          max_level?: number | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          raw?: Json
          server_id?: number
          skills?: Json
          slot?: number | null
          snapshot_id?: string
          source_command?: string
          stage?: number | null
          star?: number | null
          troop_class?: number | null
          troop_count?: number | null
          troop_type_id?: string | null
          weapon_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "arena_entry_heroes_arena_entry_id_fkey"
            columns: ["arena_entry_id"]
            isOneToOne: false
            referencedRelation: "arena_entries"
            referencedColumns: ["snapshot_id"]
          },
          {
            foreignKeyName: "arena_entry_heroes_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "arena_entry_heroes_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "arena_entry_heroes_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      arena_matches: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          idempotency_key: string
          observation_id: string
          opponent_game_uid: number | null
          opponent_name: string | null
          parser_version: string
          player_id: string | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          week_start: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          idempotency_key: string
          observation_id: string
          opponent_game_uid?: number | null
          opponent_name?: string | null
          parser_version: string
          player_id?: string | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          week_start: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          idempotency_key?: string
          observation_id?: string
          opponent_game_uid?: number | null
          opponent_name?: string | null
          parser_version?: string
          player_id?: string | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "arena_matches_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "arena_matches_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "arena_matches_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "arena_matches_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      arena_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          entry_count: number | null
          idempotency_key: string
          league: number | null
          observation_id: string
          parser_version: string
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          week_start: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          entry_count?: number | null
          idempotency_key: string
          league?: number | null
          observation_id: string
          parser_version: string
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          week_start: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          entry_count?: number | null
          idempotency_key?: string
          league?: number | null
          observation_id?: string
          parser_version?: string
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "arena_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "arena_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "arena_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_service: Database["public"]["Enums"]["app_role"] | null
          actor_user_id: string | null
          after: Json | null
          audit_log_id: string
          before: Json | null
          entity_id: string | null
          entity_type: string
          occurred_at: string
        }
        Insert: {
          action: string
          actor_service?: Database["public"]["Enums"]["app_role"] | null
          actor_user_id?: string | null
          after?: Json | null
          audit_log_id?: string
          before?: Json | null
          entity_id?: string | null
          entity_type: string
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_service?: Database["public"]["Enums"]["app_role"] | null
          actor_user_id?: string | null
          after?: Json | null
          audit_log_id?: string
          before?: Json | null
          entity_id?: string | null
          entity_type?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
        ]
      }
      battle_report_ingests: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          expires_at: string | null
          from_game_uid: number | null
          idempotency_key: string
          ingest_id: string
          mail_type: number | null
          mail_uid: string | null
          observation_id: string
          parser_version: string
          raw: Json
          report_content: string | null
          report_kind: string
          report_marker: Json | null
          sent_at: string | null
          source_command: string
          to_game_uid: number | null
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          expires_at?: string | null
          from_game_uid?: number | null
          idempotency_key: string
          ingest_id?: string
          mail_type?: number | null
          mail_uid?: string | null
          observation_id: string
          parser_version: string
          raw?: Json
          report_content?: string | null
          report_kind: string
          report_marker?: Json | null
          sent_at?: string | null
          source_command: string
          to_game_uid?: number | null
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          expires_at?: string | null
          from_game_uid?: number | null
          idempotency_key?: string
          ingest_id?: string
          mail_type?: number | null
          mail_uid?: string | null
          observation_id?: string
          parser_version?: string
          raw?: Json
          report_content?: string | null
          report_kind?: string
          report_marker?: Json | null
          sent_at?: string | null
          source_command?: string
          to_game_uid?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "battle_report_ingests_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "battle_report_ingests_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      capabilities: {
        Row: {
          capability: string
          description: string
          label: string
          sort_order: number
        }
        Insert: {
          capability: string
          description?: string
          label: string
          sort_order?: number
        }
        Update: {
          capability?: string
          description?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      collector_heartbeats: {
        Row: {
          collector_id: string
          details: Json
          heartbeat_id: string
          last_packet_at: string | null
          last_sync_at: string | null
          outbox_depth: number | null
          reported_at: string
          status: Database["public"]["Enums"]["collector_status"]
          version: string | null
        }
        Insert: {
          collector_id: string
          details?: Json
          heartbeat_id?: string
          last_packet_at?: string | null
          last_sync_at?: string | null
          outbox_depth?: number | null
          reported_at?: string
          status: Database["public"]["Enums"]["collector_status"]
          version?: string | null
        }
        Update: {
          collector_id?: string
          details?: Json
          heartbeat_id?: string
          last_packet_at?: string | null
          last_sync_at?: string | null
          outbox_depth?: number | null
          reported_at?: string
          status?: Database["public"]["Enums"]["collector_status"]
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collector_heartbeats_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      collectors: {
        Row: {
          collector_id: string
          created_at: string
          last_heartbeat_at: string | null
          last_packet_at: string | null
          last_sync_at: string | null
          name: string
          outbox_depth: number | null
          status: Database["public"]["Enums"]["collector_status"]
          updated_at: string
          version: string | null
        }
        Insert: {
          collector_id?: string
          created_at?: string
          last_heartbeat_at?: string | null
          last_packet_at?: string | null
          last_sync_at?: string | null
          name: string
          outbox_depth?: number | null
          status?: Database["public"]["Enums"]["collector_status"]
          updated_at?: string
          version?: string | null
        }
        Update: {
          collector_id?: string
          created_at?: string
          last_heartbeat_at?: string | null
          last_packet_at?: string | null
          last_sync_at?: string | null
          name?: string
          outbox_depth?: number | null
          status?: Database["public"]["Enums"]["collector_status"]
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      comment_notifications: {
        Row: {
          comment_id: string
          created_at: string
          notification_id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          notification_id?: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          notification_id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["comment_id"]
          },
          {
            foreignKeyName: "comment_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "comment_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "comment_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "comment_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
        ]
      }
      component_metrics: {
        Row: {
          created_at: string
          family: string
          label: string
          metric: string
          notes: string
          role: string
          sort_order: number
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          family: string
          label: string
          metric: string
          notes?: string
          role: string
          sort_order?: number
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          family?: string
          label?: string
          metric?: string
          notes?: string
          role?: string
          sort_order?: number
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      data_change_notifications: {
        Row: {
          created_at: string
          entity_key: string | null
          notification_id: number
          payload: Json
          server_id: number | null
          topic: string
        }
        Insert: {
          created_at?: string
          entity_key?: string | null
          notification_id?: never
          payload?: Json
          server_id?: number | null
          topic: string
        }
        Update: {
          created_at?: string
          entity_key?: string | null
          notification_id?: never
          payload?: Json
          server_id?: number | null
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_change_notifications_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      favourites: {
        Row: {
          alliance_id: string | null
          announcement_id: string | null
          created_at: string
          favourite_id: string
          guide_id: string | null
          player_id: string | null
          server_id: number | null
          user_id: string
        }
        Insert: {
          alliance_id?: string | null
          announcement_id?: string | null
          created_at?: string
          favourite_id?: string
          guide_id?: string | null
          player_id?: string | null
          server_id?: number | null
          user_id: string
        }
        Update: {
          alliance_id?: string | null
          announcement_id?: string | null
          created_at?: string
          favourite_id?: string
          guide_id?: string | null
          player_id?: string | null
          server_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favourites_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "favourites_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["announcement_id"]
          },
          {
            foreignKeyName: "favourites_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["guide_id"]
          },
          {
            foreignKeyName: "favourites_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "favourites_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "favourites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      guides: {
        Row: {
          body: string
          category: string
          channels: string[] | null
          created_at: string
          created_by: string | null
          guide_id: string
          pinned: boolean
          published_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          category?: string
          channels?: string[] | null
          created_at?: string
          created_by?: string | null
          guide_id?: string
          pinned?: boolean
          published_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          channels?: string[] | null
          created_at?: string
          created_by?: string | null
          guide_id?: string
          pinned?: boolean
          published_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      heroes: {
        Row: {
          created_at: string
          grade: number | null
          hero_id: number
          name: string | null
          notes: string
          troop_class: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          grade?: number | null
          hero_id: number
          name?: string | null
          notes?: string
          troop_class?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          grade?: number | null
          hero_id?: number
          name?: string | null
          notes?: string
          troop_class?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      join_code_attempts: {
        Row: {
          failed_count: number
          first_failed_at: string
          last_failed_at: string
          user_id: string
        }
        Insert: {
          failed_count?: number
          first_failed_at?: string
          last_failed_at?: string
          user_id: string
        }
        Update: {
          failed_count?: number
          first_failed_at?: string
          last_failed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "join_code_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      join_codes: {
        Row: {
          code: string
          code_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          grants_role: Database["public"]["Enums"]["app_role"]
          max_uses: number | null
          note: string | null
          revoked_at: string | null
          used_count: number
        }
        Insert: {
          code: string
          code_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          grants_role?: Database["public"]["Enums"]["app_role"]
          max_uses?: number | null
          note?: string | null
          revoked_at?: string | null
          used_count?: number
        }
        Update: {
          code?: string
          code_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          grants_role?: Database["public"]["Enums"]["app_role"]
          max_uses?: number | null
          note?: string | null
          revoked_at?: string | null
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "join_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "join_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "join_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "join_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
        ]
      }
      member_roster_current: {
        Row: {
          computed_rank: string | null
          growth_1d: number | null
          growth_1d_at: string | null
          growth_7d: number | null
          growth_7d_at: string | null
          member_rank: number | null
          player_id: string
          rank_score: number | null
          refreshed_at: string
        }
        Insert: {
          computed_rank?: string | null
          growth_1d?: number | null
          growth_1d_at?: string | null
          growth_7d?: number | null
          growth_7d_at?: string | null
          member_rank?: number | null
          player_id: string
          rank_score?: number | null
          refreshed_at?: string
        }
        Update: {
          computed_rank?: string | null
          growth_1d?: number | null
          growth_1d_at?: string | null
          growth_7d?: number | null
          growth_7d_at?: string | null
          member_rank?: number | null
          player_id?: string
          rank_score?: number | null
          refreshed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roster_current_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      metric_registry: {
        Row: {
          aggregation: string
          created_at: string
          display_name: string
          domain: string
          entity_scope: string
          metric_key: string
          min_observation_count: number
          missing_data_policy: string
          normalization_method: string | null
          outlier_policy: Json
          recommended_period: string | null
          source_priority: Json
          unit: string
          updated_at: string
        }
        Insert: {
          aggregation: string
          created_at?: string
          display_name: string
          domain: string
          entity_scope: string
          metric_key: string
          min_observation_count?: number
          missing_data_policy?: string
          normalization_method?: string | null
          outlier_policy?: Json
          recommended_period?: string | null
          source_priority?: Json
          unit: string
          updated_at?: string
        }
        Update: {
          aggregation?: string
          created_at?: string
          display_name?: string
          domain?: string
          entity_scope?: string
          metric_key?: string
          min_observation_count?: number
          missing_data_policy?: string
          normalization_method?: string | null
          outlier_policy?: Json
          recommended_period?: string | null
          source_priority?: Json
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_channels: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          last_delivered_at: string | null
          last_error: string | null
          updated_at: string
          updated_by: string | null
          webhook_url: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          last_delivered_at?: string | null
          last_error?: string | null
          updated_at?: string
          updated_by?: string | null
          webhook_url: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          last_delivered_at?: string | null
          last_error?: string | null
          updated_at?: string
          updated_by?: string | null
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_channels_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          body: string
          channel: string
          created_at: string
          delivered_at: string | null
          event: string
          idempotency_key: string
          image_url: string | null
          last_error: string | null
          notification_id: number
          title: string
          transport_request_id: number | null
        }
        Insert: {
          attempts?: number
          body: string
          channel: string
          created_at?: string
          delivered_at?: string | null
          event: string
          idempotency_key: string
          image_url?: string | null
          last_error?: string | null
          notification_id?: never
          title: string
          transport_request_id?: number | null
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          delivered_at?: string | null
          event?: string
          idempotency_key?: string
          image_url?: string | null
          last_error?: string | null
          notification_id?: never
          title?: string
          transport_request_id?: number | null
        }
        Relationships: []
      }
      pets: {
        Row: {
          created_at: string
          name: string | null
          notes: string
          pet_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          name?: string | null
          notes?: string
          pet_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          name?: string | null
          notes?: string
          pet_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      player_claims: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          note: string | null
          player_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          note?: string | null
          player_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          note?: string | null
          player_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_claims_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_claims_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_claims_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_claims_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_claims_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_component_power_snapshots: {
        Row: {
          alliance_abbr: string | null
          alliance_name: string | null
          board_type: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          idempotency_key: string
          metric: string
          name: string | null
          observation_id: string
          parser_version: string
          player_id: string | null
          power: number | null
          rank: number | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          unit_id: number | null
        }
        Insert: {
          alliance_abbr?: string | null
          alliance_name?: string | null
          board_type?: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          idempotency_key: string
          metric: string
          name?: string | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          power?: number | null
          rank?: number | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          unit_id?: number | null
        }
        Update: {
          alliance_abbr?: string | null
          alliance_name?: string | null
          board_type?: number | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          idempotency_key?: string
          metric?: string
          name?: string | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          power?: number | null
          rank?: number | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          unit_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_component_power_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "player_component_power_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "player_component_power_snapshots_metric_fkey"
            columns: ["metric"]
            isOneToOne: false
            referencedRelation: "component_metrics"
            referencedColumns: ["metric"]
          },
          {
            foreignKeyName: "player_component_power_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_component_power_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_contributions: {
        Row: {
          daily_donation_score: number | null
          daily_donation_updated_at: string | null
          duel_daily_score: number | null
          duel_daily_updated_at: string | null
          duel_round_score: number | null
          duel_round_updated_at: string | null
          duel_weekly_score: number | null
          duel_weekly_updated_at: string | null
          player_id: string
          weekly_donation_score: number | null
          weekly_donation_updated_at: string | null
        }
        Insert: {
          daily_donation_score?: number | null
          daily_donation_updated_at?: string | null
          duel_daily_score?: number | null
          duel_daily_updated_at?: string | null
          duel_round_score?: number | null
          duel_round_updated_at?: string | null
          duel_weekly_score?: number | null
          duel_weekly_updated_at?: string | null
          player_id: string
          weekly_donation_score?: number | null
          weekly_donation_updated_at?: string | null
        }
        Update: {
          daily_donation_score?: number | null
          daily_donation_updated_at?: string | null
          duel_daily_score?: number | null
          duel_daily_updated_at?: string | null
          duel_round_score?: number | null
          duel_round_updated_at?: string | null
          duel_weekly_score?: number | null
          duel_weekly_updated_at?: string | null
          player_id?: string
          weekly_donation_score?: number | null
          weekly_donation_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_contributions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_detail_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          components_sum_matches: boolean | null
          created_at: string
          game_uid: number
          idempotency_key: string
          observation_id: string
          parser_version: string
          player_id: string
          power_components: Json
          power_total: number | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          components_sum_matches?: boolean | null
          created_at?: string
          game_uid: number
          idempotency_key: string
          observation_id: string
          parser_version: string
          player_id: string
          power_components?: Json
          power_total?: number | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          components_sum_matches?: boolean | null
          created_at?: string
          game_uid?: number
          idempotency_key?: string
          observation_id?: string
          parser_version?: string
          player_id?: string
          power_components?: Json
          power_total?: number | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_detail_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "player_detail_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "player_detail_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_detail_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_month_cards: {
        Row: {
          expires_at: string
          observed_at: string
          player_id: string
        }
        Insert: {
          expires_at: string
          observed_at: string
          player_id: string
        }
        Update: {
          expires_at?: string
          observed_at?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_month_cards_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_names: {
        Row: {
          first_seen_at: string
          last_seen_at: string
          name: string
          player_id: string
          player_name_id: string
        }
        Insert: {
          first_seen_at: string
          last_seen_at: string
          name: string
          player_id: string
          player_name_id?: string
        }
        Update: {
          first_seen_at?: string
          last_seen_at?: string
          name?: string
          player_id?: string
          player_name_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_names_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_presence: {
        Row: {
          observed_at: string
          offline_since: string | null
          online_state: string | null
          player_id: string
        }
        Insert: {
          observed_at: string
          offline_since?: string | null
          online_state?: string | null
          player_id: string
        }
        Update: {
          observed_at?: string
          offline_since?: string | null
          online_state?: string | null
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_presence_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_ranks: {
        Row: {
          assigned_rank: string
          player_id: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          assigned_rank: string
          player_id: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          assigned_rank?: string
          player_id?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_ranks_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_ranks_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_season_force_snapshots: {
        Row: {
          alliance_abbr: string | null
          alliance_external_id: string | null
          alliance_name: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          country: string | null
          created_at: string
          force: number | null
          game_uid: number
          idempotency_key: string
          name: string | null
          observation_id: string
          parser_version: string
          player_id: string | null
          rank: number | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_abbr?: string | null
          alliance_external_id?: string | null
          alliance_name?: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          country?: string | null
          created_at?: string
          force?: number | null
          game_uid: number
          idempotency_key: string
          name?: string | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          rank?: number | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_abbr?: string | null
          alliance_external_id?: string | null
          alliance_name?: string | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          country?: string | null
          created_at?: string
          force?: number | null
          game_uid?: number
          idempotency_key?: string
          name?: string | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          rank?: number | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_season_force_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "player_season_force_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "player_season_force_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_season_force_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_snapshots: {
        Row: {
          alliance_external_id: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          hq_level: number | null
          idempotency_key: string
          kills: number | null
          month_card_expires_at: string | null
          name: string | null
          observation_id: string
          parser_version: string
          player_id: string
          power: number | null
          rank: number | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_external_id?: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          hq_level?: number | null
          idempotency_key: string
          kills?: number | null
          month_card_expires_at?: string | null
          name?: string | null
          observation_id: string
          parser_version: string
          player_id: string
          power?: number | null
          rank?: number | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_external_id?: string | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          hq_level?: number | null
          idempotency_key?: string
          kills?: number | null
          month_card_expires_at?: string | null
          name?: string | null
          observation_id?: string
          parser_version?: string
          player_id?: string
          power?: number | null
          rank?: number | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "player_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "player_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_vip: {
        Row: {
          observed_at: string
          player_id: string
          svip_level: number | null
          vip_expires_at: string | null
          vip_level: number | null
        }
        Insert: {
          observed_at: string
          player_id: string
          svip_level?: number | null
          vip_expires_at?: string | null
          vip_level?: number | null
        }
        Update: {
          observed_at?: string
          player_id?: string
          svip_level?: number | null
          vip_expires_at?: string | null
          vip_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_vip_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          current_alliance_id: string | null
          current_name: string | null
          first_seen_at: string
          game_uid: number
          hq_level: number | null
          kills: number | null
          last_seen_at: string | null
          player_id: string
          power: number | null
          roster_observed_at: string | null
          server_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_alliance_id?: string | null
          current_name?: string | null
          first_seen_at?: string
          game_uid: number
          hq_level?: number | null
          kills?: number | null
          last_seen_at?: string | null
          player_id?: string
          power?: number | null
          roster_observed_at?: string | null
          server_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_alliance_id?: string | null
          current_name?: string | null
          first_seen_at?: string
          game_uid?: number
          hq_level?: number | null
          kills?: number | null
          last_seen_at?: string | null
          player_id?: string
          power?: number | null
          roster_observed_at?: string | null
          server_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_current_alliance_id_fkey"
            columns: ["current_alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "players_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      post_comments: {
        Row: {
          announcement_id: string | null
          author_user_id: string | null
          body: string
          comment_id: string
          created_at: string
          deleted_at: string | null
          guide_id: string | null
          parent_comment_id: string | null
          updated_at: string
        }
        Insert: {
          announcement_id?: string | null
          author_user_id?: string | null
          body: string
          comment_id?: string
          created_at?: string
          deleted_at?: string | null
          guide_id?: string | null
          parent_comment_id?: string | null
          updated_at?: string
        }
        Update: {
          announcement_id?: string | null
          author_user_id?: string | null
          body?: string
          comment_id?: string
          created_at?: string
          deleted_at?: string | null
          guide_id?: string | null
          parent_comment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["announcement_id"]
          },
          {
            foreignKeyName: "post_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["guide_id"]
          },
          {
            foreignKeyName: "post_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["comment_id"]
          },
        ]
      }
      post_reads: {
        Row: {
          announcement_id: string | null
          guide_id: string | null
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id?: string | null
          guide_id?: string | null
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string | null
          guide_id?: string | null
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["announcement_id"]
          },
          {
            foreignKeyName: "post_reads_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["guide_id"]
          },
          {
            foreignKeyName: "post_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      post_views: {
        Row: {
          announcement_id: string | null
          guide_id: string | null
          view_day: string
          views: number
        }
        Insert: {
          announcement_id?: string | null
          guide_id?: string | null
          view_day: string
          views?: number
        }
        Update: {
          announcement_id?: string | null
          guide_id?: string | null
          view_day?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_views_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["announcement_id"]
          },
          {
            foreignKeyName: "post_views_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["guide_id"]
          },
        ]
      }
      rank_period_snapshots: {
        Row: {
          activity_score: number | null
          computed_at: string
          donation_pct: number | null
          donation_total: number | null
          donation_week1: number | null
          donation_week1_at: string | null
          donation_week2: number | null
          donation_week2_at: string | null
          duel_pct: number | null
          duel_total: number | null
          duel_week1: number | null
          duel_week1_at: string | null
          duel_week2: number | null
          duel_week2_at: string | null
          game_uid: number
          growth_pct: number | null
          name: string | null
          offline_hours: number | null
          period_start: string
          player_id: string
          power_end: number | null
          power_end_at: string | null
          power_growth: number | null
          power_start: number | null
          power_start_at: string | null
          scoring_version: number
          snapshot_id: string
          tier: string | null
          tier_reason: string | null
        }
        Insert: {
          activity_score?: number | null
          computed_at?: string
          donation_pct?: number | null
          donation_total?: number | null
          donation_week1?: number | null
          donation_week1_at?: string | null
          donation_week2?: number | null
          donation_week2_at?: string | null
          duel_pct?: number | null
          duel_total?: number | null
          duel_week1?: number | null
          duel_week1_at?: string | null
          duel_week2?: number | null
          duel_week2_at?: string | null
          game_uid: number
          growth_pct?: number | null
          name?: string | null
          offline_hours?: number | null
          period_start: string
          player_id: string
          power_end?: number | null
          power_end_at?: string | null
          power_growth?: number | null
          power_start?: number | null
          power_start_at?: string | null
          scoring_version?: number
          snapshot_id?: string
          tier?: string | null
          tier_reason?: string | null
        }
        Update: {
          activity_score?: number | null
          computed_at?: string
          donation_pct?: number | null
          donation_total?: number | null
          donation_week1?: number | null
          donation_week1_at?: string | null
          donation_week2?: number | null
          donation_week2_at?: string | null
          duel_pct?: number | null
          duel_total?: number | null
          duel_week1?: number | null
          duel_week1_at?: string | null
          duel_week2?: number | null
          duel_week2_at?: string | null
          game_uid?: number
          growth_pct?: number | null
          name?: string | null
          offline_hours?: number | null
          period_start?: string
          player_id?: string
          power_end?: number | null
          power_end_at?: string | null
          power_growth?: number | null
          power_start?: number | null
          power_start_at?: string | null
          scoring_version?: number
          snapshot_id?: string
          tier?: string | null
          tier_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rank_period_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      refresh_jobs: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          collector_id: string | null
          created_at: string
          finished_at: string | null
          job_id: string
          job_type: string
          last_error: string | null
          next_attempt_at: string
          payload: Json
          priority: number
          requested_by: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          collector_id?: string | null
          created_at?: string
          finished_at?: string | null
          job_id?: string
          job_type: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          priority?: number
          requested_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          collector_id?: string | null
          created_at?: string
          finished_at?: string | null
          job_id?: string
          job_type?: string
          last_error?: string | null
          next_attempt_at?: string
          payload?: Json
          priority?: number
          requested_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refresh_jobs_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "refresh_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refresh_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refresh_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "refresh_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          capability: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          capability: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          capability?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_capability_fkey"
            columns: ["capability"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["capability"]
          },
        ]
      }
      schedule_categories: {
        Row: {
          category: string
          channel: string | null
          colour: string | null
          created_at: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          channel?: string | null
          colour?: string | null
          created_at?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          channel?: string | null
          colour?: string | null
          created_at?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_categories_channel_fkey"
            columns: ["channel"]
            isOneToOne: false
            referencedRelation: "notification_channel_names"
            referencedColumns: ["channel"]
          },
          {
            foreignKeyName: "schedule_categories_channel_fkey"
            columns: ["channel"]
            isOneToOne: false
            referencedRelation: "notification_channels"
            referencedColumns: ["channel"]
          },
        ]
      }
      schedule_events: {
        Row: {
          body: string | null
          category: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          schedule_event_id: string
          series_id: string | null
          source: string
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          schedule_event_id?: string
          series_id?: string | null
          source?: string
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          schedule_event_id?: string
          series_id?: string | null
          source?: string
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "schedule_categories"
            referencedColumns: ["category"]
          },
          {
            foreignKeyName: "schedule_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "schedule_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "schedule_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "schedule_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
          },
        ]
      }
      schedule_reminders: {
        Row: {
          created_at: string
          minutes_before: number
          reminder_id: string
          schedule_event_id: string
        }
        Insert: {
          created_at?: string
          minutes_before: number
          reminder_id?: string
          schedule_event_id: string
        }
        Update: {
          created_at?: string
          minutes_before?: number
          reminder_id?: string
          schedule_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_reminders_schedule_event_id_fkey"
            columns: ["schedule_event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["schedule_event_id"]
          },
        ]
      }
      schema_observations: {
        Row: {
          collector_id: string | null
          fingerprint: string
          first_seen_at: string
          last_seen_at: string
          review_status: string
          sample: Json
          schema_observation_id: string
          seen_count: number
          source_command: string
        }
        Insert: {
          collector_id?: string | null
          fingerprint: string
          first_seen_at?: string
          last_seen_at?: string
          review_status?: string
          sample?: Json
          schema_observation_id?: string
          seen_count?: number
          source_command: string
        }
        Update: {
          collector_id?: string | null
          fingerprint?: string
          first_seen_at?: string
          last_seen_at?: string
          review_status?: string
          sample?: Json
          schema_observation_id?: string
          seen_count?: number
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "schema_observations_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      season_building_snapshots: {
        Row: {
          building_type_id: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          idempotency_key: string
          level: number | null
          object_id: number | null
          observation_id: string
          parser_version: string
          player_id: string | null
          point_id: number
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          x: number
          y: number
        }
        Insert: {
          building_type_id?: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          idempotency_key: string
          level?: number | null
          object_id?: number | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          point_id: number
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          x: number
          y: number
        }
        Update: {
          building_type_id?: number | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          idempotency_key?: string
          level?: number | null
          object_id?: number | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          point_id?: number
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_building_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "season_building_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "season_building_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "season_building_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      servers: {
        Row: {
          created_at: string
          first_seen_at: string
          is_tracked: boolean
          merged_into_server_id: number | null
          server_group: string
          server_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_seen_at?: string
          is_tracked?: boolean
          merged_into_server_id?: number | null
          server_group: string
          server_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_seen_at?: string
          is_tracked?: boolean
          merged_into_server_id?: number | null
          server_group?: string
          server_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "servers_merged_into_server_id_fkey"
            columns: ["merged_into_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          collector_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          refresh_job_id: string | null
          result: Json
          run_id: string
          started_at: string
          status: Database["public"]["Enums"]["job_status"]
          workflow: string
        }
        Insert: {
          collector_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          refresh_job_id?: string | null
          result?: Json
          run_id?: string
          started_at: string
          status: Database["public"]["Enums"]["job_status"]
          workflow: string
        }
        Update: {
          collector_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          refresh_job_id?: string | null
          result?: Json
          run_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "workflow_runs_refresh_job_id_fkey"
            columns: ["refresh_job_id"]
            isOneToOne: false
            referencedRelation: "refresh_jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      world_city_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          hq_level: number | null
          idempotency_key: string
          name: string | null
          observation_id: string
          parser_version: string
          player_id: string | null
          point_id: number
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          x: number
          y: number
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          hq_level?: number | null
          idempotency_key: string
          name?: string | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          point_id: number
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          x: number
          y: number
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          hq_level?: number | null
          idempotency_key?: string
          name?: string | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          point_id?: number
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "world_city_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "world_city_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "world_city_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "world_city_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
    }
    Views: {
      activity_daily: {
        Row: {
          alliance_days: number | null
          comment_count: number | null
          day: string | null
          login_days: number | null
          player_days: number | null
          points: number | null
          server_days: number | null
          user_id: string | null
        }
        Relationships: []
      }
      activity_members: {
        Row: {
          display_name: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      alliance_daily_contribution: {
        Row: {
          alliance_id: string | null
          avg_per_member: number | null
          game_day: string | null
          kind: string | null
          last_capture_at: string | null
          members_counted: number | null
          readings: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
        ]
      }
      alliance_departures: {
        Row: {
          alliance_id: string | null
          confirmed: boolean | null
          first_seen_in_alliance_at: string | null
          game_uid: number | null
          last_hq_level: number | null
          last_kills: number | null
          last_known_name: string | null
          last_member_rank: number | null
          last_power: number | null
          last_seen_in_alliance_at: string | null
          player_id: string | null
          roster_captured_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      alliance_growth: {
        Row: {
          alliance_id: string | null
          code: string | null
          cross_rank_climb: number | null
          cross_rank_first: number | null
          cross_rank_last: number | null
          first_at: string | null
          is_own: boolean | null
          last_at: string | null
          member_count: number | null
          name: string | null
          power_first: number | null
          power_growth: number | null
          power_growth_pct: number | null
          power_last: number | null
          rank_climb: number | null
          rank_first: number | null
          rank_last: number | null
          readings: number | null
          server_id: number | null
          span_days: number | null
        }
        Insert: {
          alliance_id?: string | null
          code?: string | null
          cross_rank_climb?: number | null
          cross_rank_first?: number | null
          cross_rank_last?: number | null
          first_at?: string | null
          is_own?: boolean | null
          last_at?: string | null
          member_count?: number | null
          name?: string | null
          power_first?: number | null
          power_growth?: number | null
          power_growth_pct?: number | null
          power_last?: number | null
          rank_climb?: number | null
          rank_first?: number | null
          rank_last?: number | null
          readings?: number | null
          server_id?: number | null
          span_days?: number | null
        }
        Update: {
          alliance_id?: string | null
          code?: string | null
          cross_rank_climb?: number | null
          cross_rank_first?: number | null
          cross_rank_last?: number | null
          first_at?: string | null
          is_own?: boolean | null
          last_at?: string | null
          member_count?: number | null
          name?: string | null
          power_first?: number | null
          power_growth?: number | null
          power_growth_pct?: number | null
          power_last?: number | null
          rank_climb?: number | null
          rank_first?: number | null
          rank_last?: number | null
          readings?: number | null
          server_id?: number | null
          span_days?: number | null
        }
        Relationships: []
      }
      alliance_latest: {
        Row: {
          alliance_id: string | null
          captured_at: string | null
          code: string | null
          external_id: string | null
          member_count: number | null
          name: string | null
          power: number | null
          rank: number | null
          server_id: number | null
          snapshot_id: string | null
        }
        Insert: {
          alliance_id?: string | null
          captured_at?: string | null
          code?: string | null
          external_id?: string | null
          member_count?: number | null
          name?: string | null
          power?: number | null
          rank?: number | null
          server_id?: number | null
          snapshot_id?: string | null
        }
        Update: {
          alliance_id?: string | null
          captured_at?: string | null
          code?: string | null
          external_id?: string | null
          member_count?: number | null
          name?: string | null
          power?: number | null
          rank?: number | null
          server_id?: number | null
          snapshot_id?: string | null
        }
        Relationships: []
      }
      alliance_power_history: {
        Row: {
          alliance_id: string | null
          board_scope: string | null
          board_size: number | null
          captured_at: string | null
          code: string | null
          is_own: boolean | null
          member_count: number | null
          name: string | null
          power: number | null
          rank: number | null
          server_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_roster_history: {
        Row: {
          alliance_id: string | null
          avg_hq_level: number | null
          avg_power: number | null
          captured_at: string | null
          expected_members: number | null
          max_hq_level: number | null
          max_power: number | null
          median_power: number | null
          members_at_hq35: number | null
          observed_members: number | null
          officers: number | null
          presence_unknown: number | null
          snapshot_complete: boolean | null
          total_kills: number | null
          total_power: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
        ]
      }
      alliance_roster_latest: {
        Row: {
          alliance_id: string | null
          captured_at: string | null
          expected_members: number | null
          game_uid: number | null
          hq_level: number | null
          kills: number | null
          member_rank: number | null
          name: string | null
          observed_members: number | null
          player_id: string | null
          power: number | null
          server_id: number | null
          snapshot_complete: boolean | null
          snapshot_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      app_user_directory: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string | null
          email_confirmed_at: string | null
          game_rank: string | null
          last_sign_in_at: string | null
          player_id: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_users_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "app_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      event_scoreboard: {
        Row: {
          display_name: string | null
          points: number | null
        }
        Relationships: []
      }
      member_roster: {
        Row: {
          assigned_rank: string | null
          computed_rank: string | null
          current_name: string | null
          daily_donation_score: number | null
          duel_daily_score: number | null
          duel_round_score: number | null
          duel_weekly_score: number | null
          growth_1d: number | null
          growth_1d_at: string | null
          growth_7d: number | null
          growth_7d_at: string | null
          hq_level: number | null
          kills: number | null
          last_online_at: string | null
          last_seen_at: string | null
          member_rank: number | null
          month_card_expires_at: string | null
          online_state: string | null
          player_id: string | null
          power: number | null
          rank_score: number | null
          svip_level: number | null
          vip_expires_at: string | null
          vip_level: number | null
          weekly_donation_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "member_roster_current_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      notification_channel_names: {
        Row: {
          channel: string | null
          enabled: boolean | null
        }
        Insert: {
          channel?: string | null
          enabled?: boolean | null
        }
        Update: {
          channel?: string | null
          enabled?: boolean | null
        }
        Relationships: []
      }
      own_player_ids: {
        Row: {
          player_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alliance_member_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      pending_access: {
        Row: {
          created_at: string | null
          last_sign_in_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
      player_component_power_history: {
        Row: {
          board_size: number | null
          captured_at: string | null
          family: string | null
          metric: string | null
          metric_label: string | null
          player_id: string | null
          power: number | null
          rank: number | null
          role: string | null
          server_id: number | null
          sort_order: number | null
          source_command: string | null
          unit_grade: number | null
          unit_id: number | null
          unit_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_component_power_snapshots_metric_fkey"
            columns: ["metric"]
            isOneToOne: false
            referencedRelation: "component_metrics"
            referencedColumns: ["metric"]
          },
          {
            foreignKeyName: "player_component_power_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_component_power_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_current_rank: {
        Row: {
          assigned_rank: string | null
          computed_reason: string | null
          computed_tier: string | null
          donation_pct: number | null
          duel_pct: number | null
          growth_pct: number | null
          period_start: string | null
          player_id: string | null
          rank_score: number | null
        }
        Relationships: []
      }
      player_growth_recent: {
        Row: {
          growth_since_last: number | null
          player_id: string | null
          power: number | null
          power_at: string | null
          power_prev: number | null
          power_prev_at: string | null
          span: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_power_growth: {
        Row: {
          growth_1d: number | null
          growth_7d: number | null
          player_id: string | null
          power: number | null
          power_1d: number | null
          power_1d_at: string | null
          power_7d: number | null
          power_7d_at: string | null
          power_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      player_power_history: {
        Row: {
          board_size: number | null
          captured_at: string | null
          hq_level: number | null
          kills: number | null
          player_id: string | null
          power: number | null
          rank: number | null
          server_id: number | null
          source_command: string | null
        }
        Insert: {
          board_size?: never
          captured_at?: string | null
          hq_level?: number | null
          kills?: number | null
          player_id?: string | null
          power?: number | null
          rank?: number | null
          server_id?: number | null
          source_command?: string | null
        }
        Update: {
          board_size?: never
          captured_at?: string | null
          hq_level?: number | null
          kills?: number | null
          player_id?: string | null
          power?: number | null
          rank?: number | null
          server_id?: number | null
          source_command?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_subscriptions: {
        Row: {
          month_card_expires_at: string | null
          month_card_observed_at: string | null
          player_id: string | null
          svip_level: number | null
          vip_expires_at: string | null
          vip_level: number | null
          vip_observed_at: string | null
        }
        Relationships: []
      }
      post_authors: {
        Row: {
          display_name: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      post_comment_counts: {
        Row: {
          announcement_id: string | null
          comment_count: number | null
          guide_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["announcement_id"]
          },
          {
            foreignKeyName: "post_comments_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["guide_id"]
          },
        ]
      }
      post_view_stats: {
        Row: {
          announcement_id: string | null
          guide_id: string | null
          recent_views: number | null
          total_views: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_views_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["announcement_id"]
          },
          {
            foreignKeyName: "post_views_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["guide_id"]
          },
        ]
      }
      rank_period_latest: {
        Row: {
          activity_score: number | null
          computed_at: string | null
          donation_pct: number | null
          donation_total: number | null
          donation_week1: number | null
          donation_week1_at: string | null
          donation_week2: number | null
          donation_week2_at: string | null
          duel_pct: number | null
          duel_total: number | null
          duel_week1: number | null
          duel_week1_at: string | null
          duel_week2: number | null
          duel_week2_at: string | null
          game_uid: number | null
          growth_pct: number | null
          name: string | null
          offline_hours: number | null
          period_start: string | null
          player_id: string | null
          power_end: number | null
          power_end_at: string | null
          power_growth: number | null
          power_start: number | null
          power_start_at: string | null
          scoring_version: number | null
          snapshot_id: string | null
          tier: string | null
          tier_reason: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rank_period_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      rank_period_movement: {
        Row: {
          activity_score: number | null
          name: string | null
          period_start: string | null
          player_id: string | null
          previous_activity_score: number | null
          previous_period_start: string | null
          previous_tier: string | null
          score_change: number | null
          tier: string | null
          tier_change: number | null
          tier_reason: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rank_period_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      schedule_reminders_due: {
        Row: {
          category: string | null
          category_label: string | null
          channel: string | null
          fire_at: string | null
          minutes_before: number | null
          reminder_id: string | null
          schedule_event_id: string | null
          starts_at: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_categories_channel_fkey"
            columns: ["channel"]
            isOneToOne: false
            referencedRelation: "notification_channel_names"
            referencedColumns: ["channel"]
          },
          {
            foreignKeyName: "schedule_categories_channel_fkey"
            columns: ["channel"]
            isOneToOne: false
            referencedRelation: "notification_channels"
            referencedColumns: ["channel"]
          },
          {
            foreignKeyName: "schedule_events_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "schedule_categories"
            referencedColumns: ["category"]
          },
          {
            foreignKeyName: "schedule_reminders_schedule_event_id_fkey"
            columns: ["schedule_event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["schedule_event_id"]
          },
        ]
      }
      sync_status: {
        Row: {
          is_live: boolean | null
          last_heartbeat_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activity_day_of: { Args: { ts: string }; Returns: string }
      activity_points: {
        Args: {
          p_alliance: number
          p_comments: number
          p_logins: number
          p_player: number
          p_server: number
        }
        Returns: number
      }
      approve_player_claim: {
        Args: { p_user: string }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          note: string | null
          player_id: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "player_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      backfill_month_card_from_raw: {
        Args: never
        Returns: {
          cards: number
          member_rows: number
          player_rows: number
        }[]
      }
      build_rank_period: { Args: { p_period_start: string }; Returns: number }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_permission: { Args: { p_capability: string }; Returns: boolean }
      is_service_request: { Args: never; Returns: boolean }
      leave_alliance: { Args: never; Returns: undefined }
      linked_player_id: { Args: never; Returns: string }
      prune_collector_heartbeats: {
        Args: { p_confirm?: boolean; p_keep?: string }
        Returns: {
          cutoff: string
          deleted: number
          prunable: number
        }[]
      }
      rank_period_start: { Args: { ts: string }; Returns: string }
      rank_period_week_ends: {
        Args: { period_start: string }
        Returns: string[]
      }
      rebuild_rank_period: {
        Args: { p_apply_to_assigned?: boolean; p_period_start: string }
        Returns: number
      }
      record_departure: {
        Args: { p_action: string; p_user: string }
        Returns: undefined
      }
      record_post_view: {
        Args: { p_announcement_id?: string; p_guide_id?: string }
        Returns: undefined
      }
      redeem_join_code: {
        Args: { p_code: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      refresh_alliance_growth: {
        Args: { p_alliance_ids?: string[] }
        Returns: undefined
      }
      refresh_alliance_latest: {
        Args: { p_external_ids?: string[] }
        Returns: undefined
      }
      refresh_member_roster: { Args: never; Returns: undefined }
      reject_player_claim: {
        Args: { p_user: string }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          note: string | null
          player_id: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "player_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_member: { Args: { p_user: string }; Returns: undefined }
      reset_week_start: { Args: { ts: string }; Returns: string }
      resolve_own_alliance: { Args: never; Returns: undefined }
      retention_report: {
        Args: {
          p_confirm?: boolean
          p_keep_others?: string
          p_keep_ours?: string
        }
        Returns: {
          relation: string
          rows: number
        }[]
      }
      tier_rank: { Args: { p_tier: string }; Returns: number }
    }
    Enums: {
      app_role:
        | "viewer"
        | "member"
        | "officer"
        | "admin"
        | "collector_service"
        | "analyst_service"
      collector_status:
        | "healthy"
        | "degraded"
        | "offline"
        | "sync_backlog"
        | "ui_blocked"
        | "login_required"
        | "parser_error"
      job_status:
        | "queued"
        | "claimed"
        | "running"
        | "succeeded"
        | "failed"
        | "dead_letter"
        | "cancelled"
      measurement_type: "observed" | "calculated" | "estimated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "viewer",
        "member",
        "officer",
        "admin",
        "collector_service",
        "analyst_service",
      ],
      collector_status: [
        "healthy",
        "degraded",
        "offline",
        "sync_backlog",
        "ui_blocked",
        "login_required",
        "parser_error",
      ],
      job_status: [
        "queued",
        "claimed",
        "running",
        "succeeded",
        "failed",
        "dead_letter",
        "cancelled",
      ],
      measurement_type: ["observed", "calculated", "estimated"],
    },
  },
} as const

