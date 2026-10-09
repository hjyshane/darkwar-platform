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
      account_state_manual: {
        Row: {
          buildings: Json
          effects: Json
          hero_equips: Json
          hero_exclusives: Json
          hero_intensify: Json
          items: Json
          player_id: string
          resources: Json
          science: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          buildings?: Json
          effects?: Json
          hero_equips?: Json
          hero_exclusives?: Json
          hero_intensify?: Json
          items?: Json
          player_id: string
          resources?: Json
          science?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          buildings?: Json
          effects?: Json
          hero_equips?: Json
          hero_exclusives?: Json
          hero_intensify?: Json
          items?: Json
          player_id?: string
          resources?: Json
          science?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_state_manual_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      account_state_snapshots: {
        Row: {
          buildings: Json
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          effects: Json
          game_uid: number
          hero_equips: Json
          hero_exclusives: Json
          hero_intensify: Json
          hero_levels: Json
          hero_squads: Json
          hero_trained: Json
          idempotency_key: string
          items: Json
          mod_car_equips: Json
          observation_id: string
          parser_version: string
          pets: Json
          player_id: string | null
          raw: Json
          resources: Json
          science: Json
          server_id: number
          snapshot_id: string
          source_command: string
          timed_effects: Json
          vehicle: Json
        }
        Insert: {
          buildings?: Json
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          effects?: Json
          game_uid: number
          hero_equips?: Json
          hero_exclusives?: Json
          hero_intensify?: Json
          hero_levels?: Json
          hero_squads?: Json
          hero_trained?: Json
          idempotency_key: string
          items?: Json
          mod_car_equips?: Json
          observation_id: string
          parser_version: string
          pets?: Json
          player_id?: string | null
          raw?: Json
          resources?: Json
          science?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          timed_effects?: Json
          vehicle?: Json
        }
        Update: {
          buildings?: Json
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          effects?: Json
          game_uid?: number
          hero_equips?: Json
          hero_exclusives?: Json
          hero_intensify?: Json
          hero_levels?: Json
          hero_squads?: Json
          hero_trained?: Json
          idempotency_key?: string
          items?: Json
          mod_car_equips?: Json
          observation_id?: string
          parser_version?: string
          pets?: Json
          player_id?: string | null
          raw?: Json
          resources?: Json
          science?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          timed_effects?: Json
          vehicle?: Json
        }
        Relationships: [
          {
            foreignKeyName: "account_state_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      activity_events: {
        Row: {
          activity_day: string
          alliance_id: string | null
          kind: string
          occurred_at: string
          user_id: string
        }
        Insert: {
          activity_day?: string
          alliance_id?: string | null
          kind: string
          occurred_at?: string
          user_id: string
        }
        Update: {
          activity_day?: string
          alliance_id?: string | null
          kind?: string
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "activity_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "activity_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "activity_facts_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
      alliance_board_readings: {
        Row: {
          board_size: number
          counted_at: string
          max_server_id: number
          min_server_id: number
          observation_id: string
        }
        Insert: {
          board_size: number
          counted_at?: string
          max_server_id: number
          min_server_id: number
          observation_id: string
        }
        Update: {
          board_size?: number
          counted_at?: string
          max_server_id?: number
          min_server_id?: number
          observation_id?: string
        }
        Relationships: []
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_contribution_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "alliance_contribution_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "alliance_contribution_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_event_times: {
        Row: {
          alliance_external_id: string | null
          alliance_id: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          ends_at: string | null
          event_key: string
          idempotency_key: string
          observation_id: string
          parser_version: string
          prep_at: string | null
          raw: Json
          slot: number
          snapshot_id: string
          source_command: string
          starts_at: string
        }
        Insert: {
          alliance_external_id?: string | null
          alliance_id?: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          ends_at?: string | null
          event_key: string
          idempotency_key: string
          observation_id: string
          parser_version: string
          prep_at?: string | null
          raw?: Json
          slot: number
          snapshot_id?: string
          source_command: string
          starts_at: string
        }
        Update: {
          alliance_external_id?: string | null
          alliance_id?: string | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          ends_at?: string | null
          event_key?: string
          idempotency_key?: string
          observation_id?: string
          parser_version?: string
          prep_at?: string | null
          raw?: Json
          slot?: number
          snapshot_id?: string
          source_command?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliance_event_times_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_event_times_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_event_times_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_event_times_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "alliance_event_times_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "alliance_event_times_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "alliance_member_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "alliance_member_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_memberships: {
        Row: {
          alliance_id: string
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          alliance_id: string
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          alliance_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alliance_memberships_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_memberships_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_memberships_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alliance_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alliance_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alliance_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_names_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_season_score_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "alliance_season_score_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "alliance_season_score_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      alliance_settings: {
        Row: {
          alliance_id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          alliance_id: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          alliance_id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "alliance_settings_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_settings_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_settings_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "alliance_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "alliance_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "alliances_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      announcements: {
        Row: {
          alliance_id: string | null
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
          alliance_id?: string | null
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
          alliance_id?: string | null
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
            foreignKeyName: "announcements_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "announcements_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "announcements_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "arena_entries_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "arena_entries_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            foreignKeyName: "arena_entry_heroes_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "arena_entry_heroes_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            foreignKeyName: "arena_matches_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "arena_matches_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            foreignKeyName: "arena_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "arena_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      attendance_event_days: {
        Row: {
          alliance_id: string | null
          held_on: string
          kind: string
          note: string | null
        }
        Insert: {
          alliance_id?: string | null
          held_on: string
          kind: string
          note?: string | null
        }
        Update: {
          alliance_id?: string | null
          held_on?: string
          kind?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_event_days_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "attendance_event_days_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "attendance_event_days_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "attendance_event_days_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "attendance_event_kinds"
            referencedColumns: ["kind"]
          },
        ]
      }
      attendance_event_kinds: {
        Row: {
          archived: boolean
          board: string
          captured: boolean
          kind: string
          label: string
          sort_order: number
        }
        Insert: {
          archived?: boolean
          board?: string
          captured?: boolean
          kind: string
          label: string
          sort_order?: number
        }
        Update: {
          archived?: boolean
          board?: string
          captured?: boolean
          kind?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
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
            foreignKeyName: "battle_report_ingests_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
      black_money_battle_snapshots: {
        Row: {
          alliance_external_id: string
          alliance_id: string | null
          battle_ended_at: string
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          enemy_abbr: string | null
          enemy_name: string | null
          enemy_score: number | null
          enemy_team_index: number | null
          enemy_user_num: number | null
          idempotency_key: string
          max_user_num: number | null
          observation_id: string
          parser_version: string
          raw: Json
          score: number | null
          server_id: number
          side: number | null
          snapshot_id: string
          source_command: string
          state: number | null
          team_index: number
          user_num: number | null
        }
        Insert: {
          alliance_external_id: string
          alliance_id?: string | null
          battle_ended_at: string
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          enemy_abbr?: string | null
          enemy_name?: string | null
          enemy_score?: number | null
          enemy_team_index?: number | null
          enemy_user_num?: number | null
          idempotency_key: string
          max_user_num?: number | null
          observation_id: string
          parser_version: string
          raw?: Json
          score?: number | null
          server_id: number
          side?: number | null
          snapshot_id?: string
          source_command: string
          state?: number | null
          team_index: number
          user_num?: number | null
        }
        Update: {
          alliance_external_id?: string
          alliance_id?: string | null
          battle_ended_at?: string
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          enemy_abbr?: string | null
          enemy_name?: string | null
          enemy_score?: number | null
          enemy_team_index?: number | null
          enemy_user_num?: number | null
          idempotency_key?: string
          max_user_num?: number | null
          observation_id?: string
          parser_version?: string
          raw?: Json
          score?: number | null
          server_id?: number
          side?: number | null
          snapshot_id?: string
          source_command?: string
          state?: number | null
          team_index?: number
          user_num?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "black_money_battle_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      black_money_score_snapshots: {
        Row: {
          alliance_abbr: string | null
          alliance_external_id: string
          alliance_id: string | null
          captured_at: string
          collect_score: number | null
          collected_from_server_id: number
          collector_id: string
          created_at: string
          escort_score: number | null
          first_occupy_score: number | null
          game_uid: number
          idempotency_key: string
          kill_score: number | null
          name: string | null
          observation_id: string
          occupy_score: number | null
          parser_version: string
          player_id: string | null
          raw: Json
          reported_at: string
          score: number | null
          server_id: number
          side: number | null
          snapshot_id: string
          source_command: string
          win: number | null
        }
        Insert: {
          alliance_abbr?: string | null
          alliance_external_id: string
          alliance_id?: string | null
          captured_at: string
          collect_score?: number | null
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          escort_score?: number | null
          first_occupy_score?: number | null
          game_uid: number
          idempotency_key: string
          kill_score?: number | null
          name?: string | null
          observation_id: string
          occupy_score?: number | null
          parser_version: string
          player_id?: string | null
          raw?: Json
          reported_at: string
          score?: number | null
          server_id: number
          side?: number | null
          snapshot_id?: string
          source_command: string
          win?: number | null
        }
        Update: {
          alliance_abbr?: string | null
          alliance_external_id?: string
          alliance_id?: string | null
          captured_at?: string
          collect_score?: number | null
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          escort_score?: number | null
          first_occupy_score?: number | null
          game_uid?: number
          idempotency_key?: string
          kill_score?: number | null
          name?: string | null
          observation_id?: string
          occupy_score?: number | null
          parser_version?: string
          player_id?: string | null
          raw?: Json
          reported_at?: string
          score?: number | null
          server_id?: number
          side?: number | null
          snapshot_id?: string
          source_command?: string
          win?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "black_money_score_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      black_money_signup_snapshots: {
        Row: {
          alliance_abbr: string | null
          battle_willingness: number | null
          battle_willingness2: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          idempotency_key: string
          level: number | null
          name: string | null
          observation_id: string
          parser_version: string
          player_id: string | null
          power: number | null
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          state: number | null
          team_index: number | null
          time_index_record: string | null
        }
        Insert: {
          alliance_abbr?: string | null
          battle_willingness?: number | null
          battle_willingness2?: number | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          idempotency_key: string
          level?: number | null
          name?: string | null
          observation_id: string
          parser_version: string
          player_id?: string | null
          power?: number | null
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          state?: number | null
          team_index?: number | null
          time_index_record?: string | null
        }
        Update: {
          alliance_abbr?: string | null
          battle_willingness?: number | null
          battle_willingness2?: number | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          idempotency_key?: string
          level?: number | null
          name?: string | null
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          power?: number | null
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          state?: number | null
          team_index?: number | null
          time_index_record?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "black_money_signup_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_signup_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_signup_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "black_money_signup_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "black_money_signup_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_signup_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
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
          {
            foreignKeyName: "data_change_notifications_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      dispatch_mission_snapshots: {
        Row: {
          alliance_external_id: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          ends_at: string
          idempotency_key: string
          mission_id: number
          mission_uuid: string
          observation_id: string
          owner_game_uid: number | null
          parser_version: string
          point_id: number
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          started_at: string
          x: number
          y: number
        }
        Insert: {
          alliance_external_id?: string | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          ends_at: string
          idempotency_key: string
          mission_id: number
          mission_uuid: string
          observation_id: string
          owner_game_uid?: number | null
          parser_version: string
          point_id: number
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          started_at: string
          x: number
          y: number
        }
        Update: {
          alliance_external_id?: string | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          ends_at?: string
          idempotency_key?: string
          mission_id?: number
          mission_uuid?: string
          observation_id?: string
          owner_game_uid?: number | null
          parser_version?: string
          point_id?: number
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          started_at?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_mission_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "dispatch_mission_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      event_attendance: {
        Row: {
          alliance_id: string | null
          attended: boolean
          entered_at: string
          entered_by: string | null
          held_on: string
          kind: string
          player_id: string
          score: number | null
        }
        Insert: {
          alliance_id?: string | null
          attended: boolean
          entered_at?: string
          entered_by?: string | null
          held_on: string
          kind: string
          player_id: string
          score?: number | null
        }
        Update: {
          alliance_id?: string | null
          attended?: boolean
          entered_at?: string
          entered_by?: string | null
          held_on?: string
          kind?: string
          player_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_attendance_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "event_attendance_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "event_attendance_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "event_attendance_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "attendance_event_kinds"
            referencedColumns: ["kind"]
          },
          {
            foreignKeyName: "event_attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      event_names: {
        Row: {
          activity_id: string
          activity_type: number | null
          category: string | null
          name: string
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity_id: string
          activity_type?: number | null
          category?: string | null
          name: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity_id?: string
          activity_type?: number | null
          category?: string | null
          name?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_names_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      event_schedule_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          events: Json
          idempotency_key: string
          observation_id: string
          parser_version: string
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          events?: Json
          idempotency_key: string
          observation_id: string
          parser_version: string
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          events?: Json
          idempotency_key?: string
          observation_id?: string
          parser_version?: string
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_schedule_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "event_schedule_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "event_schedule_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "event_schedule_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "event_schedule_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "favourites_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "favourites_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
      furnace_fury_scores: {
        Row: {
          alliance_external_id: string
          alliance_id: string | null
          attacker: boolean | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          game_uid: number
          held_on: string
          idempotency_key: string
          observation_id: string
          parser_version: string
          player_id: string | null
          raw: Json
          score: number | null
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          alliance_external_id: string
          alliance_id?: string | null
          attacker?: boolean | null
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          game_uid: number
          held_on: string
          idempotency_key: string
          observation_id: string
          parser_version: string
          player_id?: string | null
          raw?: Json
          score?: number | null
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          alliance_external_id?: string
          alliance_id?: string | null
          attacker?: boolean | null
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          game_uid?: number
          held_on?: string
          idempotency_key?: string
          observation_id?: string
          parser_version?: string
          player_id?: string | null
          raw?: Json
          score?: number | null
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "furnace_fury_scores_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "furnace_fury_scores_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      game_dispatch_missions: {
        Row: {
          base_items: Json
          color: number
          duration_seconds: number
          is_special: boolean
          mission_id: number
          orange_books: number
          star: number | null
          steal_items: Json
          steal_max: number | null
          updated_at: string
        }
        Insert: {
          base_items?: Json
          color: number
          duration_seconds: number
          is_special?: boolean
          mission_id: number
          orange_books?: number
          star?: number | null
          steal_items?: Json
          steal_max?: number | null
          updated_at?: string
        }
        Update: {
          base_items?: Json
          color?: number
          duration_seconds?: number
          is_special?: boolean
          mission_id?: number
          orange_books?: number
          star?: number | null
          steal_items?: Json
          steal_max?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      game_effects: {
        Row: {
          effect_id: number
          is_minus: boolean
          name: string | null
          name_ko: string | null
          updated_at: string
        }
        Insert: {
          effect_id: number
          is_minus?: boolean
          name?: string | null
          name_ko?: string | null
          updated_at?: string
        }
        Update: {
          effect_id?: number
          is_minus?: boolean
          name?: string | null
          name_ko?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      game_event_calendar: {
        Row: {
          activity_id: string
          day: number
          event_id: string
          slot: number
          updated_at: string
        }
        Insert: {
          activity_id: string
          day: number
          event_id: string
          slot: number
          updated_at?: string
        }
        Update: {
          activity_id?: string
          day?: number
          event_id?: string
          slot?: number
          updated_at?: string
        }
        Relationships: []
      }
      game_event_scores: {
        Row: {
          action: string | null
          action_ko: string | null
          activity_id: string
          event_id: string
          per_value: number
          points: number
          score_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          action?: string | null
          action_ko?: string | null
          activity_id: string
          event_id: string
          per_value: number
          points: number
          score_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          action?: string | null
          action_ko?: string | null
          activity_id?: string
          event_id?: string
          per_value?: number
          points?: number
          score_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_event_scores_activity_id_event_id_fkey"
            columns: ["activity_id", "event_id"]
            isOneToOne: false
            referencedRelation: "game_event_themes"
            referencedColumns: ["activity_id", "event_id"]
          },
        ]
      }
      game_event_themes: {
        Row: {
          activity_id: string
          day: number | null
          event_id: string
          min_day_score: number | null
          min_week_score: number | null
          name: string | null
          name_ko: string | null
          updated_at: string
        }
        Insert: {
          activity_id: string
          day?: number | null
          event_id: string
          min_day_score?: number | null
          min_week_score?: number | null
          name?: string | null
          name_ko?: string | null
          updated_at?: string
        }
        Update: {
          activity_id?: string
          day?: number | null
          event_id?: string
          min_day_score?: number | null
          min_week_score?: number | null
          name?: string | null
          name_ko?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      game_hero_gear: {
        Row: {
          equip_id: number
          name: string | null
          name_ko: string | null
          quality: number | null
          slot: number | null
          updated_at: string
        }
        Insert: {
          equip_id: number
          name?: string | null
          name_ko?: string | null
          quality?: number | null
          slot?: number | null
          updated_at?: string
        }
        Update: {
          equip_id?: number
          name?: string | null
          name_ko?: string | null
          quality?: number | null
          slot?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      game_icon_refs: {
        Row: {
          icon_key: string
          kind: string
          ref_id: string
          updated_at: string
        }
        Insert: {
          icon_key: string
          kind: string
          ref_id: string
          updated_at?: string
        }
        Update: {
          icon_key?: string
          kind?: string
          ref_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_icons: {
        Row: {
          height: number
          icon_key: string
          image: string
          updated_at: string
          width: number
        }
        Insert: {
          height: number
          icon_key: string
          image: string
          updated_at?: string
          width: number
        }
        Update: {
          height?: number
          icon_key?: string
          image?: string
          updated_at?: string
          width?: number
        }
        Relationships: []
      }
      game_item_names: {
        Row: {
          item_id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          item_id: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          item_id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_item_names_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      game_item_values: {
        Row: {
          item_id: string
          note: string | null
          rubies: number
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          item_id: string
          note?: string | null
          rubies: number
          source: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          item_id?: string
          note?: string | null
          rubies?: number
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_item_values_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      game_items: {
        Row: {
          icon: string | null
          item_id: string
          item_type: number | null
          name: string | null
          name_ko: string | null
          quality: number | null
          updated_at: string
        }
        Insert: {
          icon?: string | null
          item_id: string
          item_type?: number | null
          name?: string | null
          name_ko?: string | null
          quality?: number | null
          updated_at?: string
        }
        Update: {
          icon?: string | null
          item_id?: string
          item_type?: number | null
          name?: string | null
          name_ko?: string | null
          quality?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      game_pack_names: {
        Row: {
          name: string
          pack_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          name: string
          pack_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          name?: string
          pack_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      game_research_tabs: {
        Row: {
          name: string | null
          name_ko: string | null
          servers: Json
          sort_order: number | null
          tab_id: number
          updated_at: string
        }
        Insert: {
          name?: string | null
          name_ko?: string | null
          servers?: Json
          sort_order?: number | null
          tab_id: number
          updated_at?: string
        }
        Update: {
          name?: string | null
          name_ko?: string | null
          servers?: Json
          sort_order?: number | null
          tab_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      game_resources: {
        Row: {
          name: string | null
          name_ko: string | null
          resource_id: number
          updated_at: string
        }
        Insert: {
          name?: string | null
          name_ko?: string | null
          resource_id: number
          updated_at?: string
        }
        Update: {
          name?: string | null
          name_ko?: string | null
          resource_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      game_season_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          end_reward_at: string | null
          idempotency_key: string
          next_stage: number | null
          next_starts_at: string | null
          observation_id: string
          parser_version: string
          raw: Json
          settle_at: string | null
          snapshot_id: string
          source_command: string
          stage: number
          starts_at: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          end_reward_at?: string | null
          idempotency_key: string
          next_stage?: number | null
          next_starts_at?: string | null
          observation_id: string
          parser_version: string
          raw?: Json
          settle_at?: string | null
          snapshot_id?: string
          source_command: string
          stage: number
          starts_at: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          end_reward_at?: string | null
          idempotency_key?: string
          next_stage?: number | null
          next_starts_at?: string | null
          observation_id?: string
          parser_version?: string
          raw?: Json
          settle_at?: string | null
          snapshot_id?: string
          source_command?: string
          stage?: number
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_season_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "game_season_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "game_season_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      game_strings: {
        Row: {
          en: string | null
          ko: string | null
          string_key: string
          updated_at: string
        }
        Insert: {
          en?: string | null
          ko?: string | null
          string_key: string
          updated_at?: string
        }
        Update: {
          en?: string | null
          ko?: string | null
          string_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_upgrade_steps: {
        Row: {
          category: number | null
          costs: Json
          kind: string
          level: number
          name: string | null
          name_ko: string | null
          power: number | null
          requires: Json
          seconds: number | null
          subject_id: string
          tier: number | null
          updated_at: string
        }
        Insert: {
          category?: number | null
          costs?: Json
          kind: string
          level: number
          name?: string | null
          name_ko?: string | null
          power?: number | null
          requires?: Json
          seconds?: number | null
          subject_id: string
          tier?: number | null
          updated_at?: string
        }
        Update: {
          category?: number | null
          costs?: Json
          kind?: string
          level?: number
          name?: string | null
          name_ko?: string | null
          power?: number | null
          requires?: Json
          seconds?: number | null
          subject_id?: string
          tier?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      gift_claim_exclusions: {
        Row: {
          alliance_id: string
          created_at: string
          excluded_by: string | null
          game_uid: number
        }
        Insert: {
          alliance_id?: string
          created_at?: string
          excluded_by?: string | null
          game_uid: number
        }
        Update: {
          alliance_id?: string
          created_at?: string
          excluded_by?: string | null
          game_uid?: number
        }
        Relationships: [
          {
            foreignKeyName: "gift_claim_exclusions_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "gift_claim_exclusions_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "gift_claim_exclusions_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
        ]
      }
      gift_code_claims: {
        Row: {
          alliance_id: string
          attempt_count: number
          claim_id: string
          code_id: string
          created_at: string
          finished_at: string | null
          game_uid: number
          last_error: string | null
          next_attempt_at: string
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
        }
        Insert: {
          alliance_id?: string
          attempt_count?: number
          claim_id?: string
          code_id: string
          created_at?: string
          finished_at?: string | null
          game_uid: number
          last_error?: string | null
          next_attempt_at?: string
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Update: {
          alliance_id?: string
          attempt_count?: number
          claim_id?: string
          code_id?: string
          created_at?: string
          finished_at?: string | null
          game_uid?: number
          last_error?: string | null
          next_attempt_at?: string
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_code_claims_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "gift_code_claims_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "gift_code_claims_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "gift_code_claims_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "gift_codes"
            referencedColumns: ["code_id"]
          },
        ]
      }
      gift_codes: {
        Row: {
          added_by: string | null
          checked_at: string | null
          code: string
          code_id: string
          first_seen_at: string
          note: string | null
          source: string
          status: string
        }
        Insert: {
          added_by?: string | null
          checked_at?: string | null
          code: string
          code_id?: string
          first_seen_at?: string
          note?: string | null
          source?: string
          status?: string
        }
        Update: {
          added_by?: string | null
          checked_at?: string | null
          code?: string
          code_id?: string
          first_seen_at?: string
          note?: string | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      guides: {
        Row: {
          alliance_id: string | null
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
          alliance_id?: string | null
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
          alliance_id?: string | null
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
            foreignKeyName: "guides_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "guides_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "guides_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
      hive_formation_slots: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          colour: string | null
          created_at: string
          dx: number
          dy: number
          formation_id: string
          kind: string
          label: string
          ordinal: number
          pinned: boolean
          player_id: string | null
          slot_id: string
          span_x: number
          span_y: number
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          colour?: string | null
          created_at?: string
          dx: number
          dy: number
          formation_id: string
          kind?: string
          label?: string
          ordinal?: number
          pinned?: boolean
          player_id?: string | null
          slot_id?: string
          span_x?: number
          span_y?: number
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          colour?: string | null
          created_at?: string
          dx?: number
          dy?: number
          formation_id?: string
          kind?: string
          label?: string
          ordinal?: number
          pinned?: boolean
          player_id?: string | null
          slot_id?: string
          span_x?: number
          span_y?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hive_formation_slots_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "hive_formation_slots_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "hive_formations"
            referencedColumns: ["formation_id"]
          },
          {
            foreignKeyName: "hive_formation_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
        ]
      }
      hive_formation_template_slots: {
        Row: {
          colour: string | null
          dx: number
          dy: number
          kind: string
          label: string
          ordinal: number
          span_x: number
          span_y: number
          template_id: string
          template_slot_id: string
        }
        Insert: {
          colour?: string | null
          dx: number
          dy: number
          kind?: string
          label?: string
          ordinal?: number
          span_x?: number
          span_y?: number
          template_id: string
          template_slot_id?: string
        }
        Update: {
          colour?: string | null
          dx?: number
          dy?: number
          kind?: string
          label?: string
          ordinal?: number
          span_x?: number
          span_y?: number
          template_id?: string
          template_slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hive_formation_template_slots_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "hive_formation_template_list"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "hive_formation_template_slots_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "hive_formation_templates"
            referencedColumns: ["template_id"]
          },
        ]
      }
      hive_formation_templates: {
        Row: {
          alliance_id: string | null
          created_at: string
          created_by: string | null
          name: string
          note: string
          template_id: string
          updated_at: string
        }
        Insert: {
          alliance_id?: string | null
          created_at?: string
          created_by?: string | null
          name: string
          note?: string
          template_id?: string
          updated_at?: string
        }
        Update: {
          alliance_id?: string | null
          created_at?: string
          created_by?: string | null
          name?: string
          note?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hive_formation_templates_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "hive_formation_templates_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "hive_formation_templates_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "hive_formation_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
      }
      hive_formations: {
        Row: {
          alliance_id: string | null
          anchor_x: number
          anchor_y: number
          created_at: string
          created_by: string | null
          formation_id: string
          is_active: boolean
          name: string
          note: string
          server_id: number
          updated_at: string
        }
        Insert: {
          alliance_id?: string | null
          anchor_x: number
          anchor_y: number
          created_at?: string
          created_by?: string | null
          formation_id?: string
          is_active?: boolean
          name: string
          note?: string
          server_id: number
          updated_at?: string
        }
        Update: {
          alliance_id?: string | null
          anchor_x?: number
          anchor_y?: number
          created_at?: string
          created_by?: string | null
          formation_id?: string
          is_active?: boolean
          name?: string
          note?: string
          server_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hive_formations_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "hive_formations_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "hive_formations_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "hive_formations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "hive_formations_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "hive_formations_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      hive_map_features: {
        Row: {
          colour: string | null
          created_at: string
          created_by: string | null
          feature_id: string
          kind: string
          name: string
          note: string
          sort_order: number
          span_x: number
          span_y: number
          updated_at: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          created_by?: string | null
          feature_id?: string
          kind?: string
          name: string
          note?: string
          sort_order?: number
          span_x?: number
          span_y?: number
          updated_at?: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          created_by?: string | null
          feature_id?: string
          kind?: string
          name?: string
          note?: string
          sort_order?: number
          span_x?: number
          span_y?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hive_map_features_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
        ]
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
          alliance_id: string | null
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
          alliance_id?: string | null
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
          alliance_id?: string | null
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
            foreignKeyName: "join_codes_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "join_codes_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "join_codes_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
          alliance_id: string | null
          below_minimum: boolean
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
          alliance_id?: string | null
          below_minimum?: boolean
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
          alliance_id?: string | null
          below_minimum?: boolean
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
            foreignKeyName: "member_roster_current_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "member_roster_current_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "member_roster_current_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
      migration_config_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          idempotency_key: string
          new_migrate_on: boolean | null
          observation_id: string
          parser_version: string
          power_brackets: Json | null
          power_tier_floors: number[] | null
          raw: Json
          snapshot_id: string
          source_command: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          idempotency_key: string
          new_migrate_on?: boolean | null
          observation_id: string
          parser_version: string
          power_brackets?: Json | null
          power_tier_floors?: number[] | null
          raw?: Json
          snapshot_id?: string
          source_command: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          idempotency_key?: string
          new_migrate_on?: boolean | null
          observation_id?: string
          parser_version?: string
          power_brackets?: Json | null
          power_tier_floors?: number[] | null
          raw?: Json
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_config_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "migration_config_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "migration_config_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      migration_events: {
        Row: {
          baseline_at: string
          created_at: string
          created_by: string | null
          event_id: string
          name: string
          settled_at: string | null
        }
        Insert: {
          baseline_at: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          name: string
          settled_at?: string | null
        }
        Update: {
          baseline_at?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          name?: string
          settled_at?: string | null
        }
        Relationships: []
      }
      migration_server_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          idempotency_key: string
          invite_left: Json | null
          king_name: string | null
          king_uid: string | null
          max_power: number | null
          migrate_left: Json | null
          need_item_id: number | null
          need_item_num: number | null
          observation_id: string
          parser_version: string
          power_limit: number | null
          power_low_limit: number[] | null
          raw: Json
          season: number | null
          season_group: number | null
          server_id: number
          server_rank_type: number | null
          snapshot_id: string
          source_command: string
          special_left: Json | null
          special_power_limit: number | null
          target_open_at: string | null
          target_power_limit: number | null
          total_count: number | null
          use_count: number | null
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          idempotency_key: string
          invite_left?: Json | null
          king_name?: string | null
          king_uid?: string | null
          max_power?: number | null
          migrate_left?: Json | null
          need_item_id?: number | null
          need_item_num?: number | null
          observation_id: string
          parser_version: string
          power_limit?: number | null
          power_low_limit?: number[] | null
          raw?: Json
          season?: number | null
          season_group?: number | null
          server_id: number
          server_rank_type?: number | null
          snapshot_id?: string
          source_command: string
          special_left?: Json | null
          special_power_limit?: number | null
          target_open_at?: string | null
          target_power_limit?: number | null
          total_count?: number | null
          use_count?: number | null
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          idempotency_key?: string
          invite_left?: Json | null
          king_name?: string | null
          king_uid?: string | null
          max_power?: number | null
          migrate_left?: Json | null
          need_item_id?: number | null
          need_item_num?: number | null
          observation_id?: string
          parser_version?: string
          power_limit?: number | null
          power_low_limit?: number[] | null
          raw?: Json
          season?: number | null
          season_group?: number | null
          server_id?: number
          server_rank_type?: number | null
          snapshot_id?: string
          source_command?: string
          special_left?: Json | null
          special_power_limit?: number | null
          target_open_at?: string | null
          target_power_limit?: number | null
          total_count?: number | null
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "migration_server_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "migration_server_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "migration_server_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      notification_channels: {
        Row: {
          alliance_id: string | null
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
          alliance_id?: string | null
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
          alliance_id?: string | null
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
            foreignKeyName: "notification_channels_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "notification_channels_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "notification_channels_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
      participation_thresholds: {
        Row: {
          alliance_id: string | null
          board: string
          daily_min: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alliance_id?: string | null
          board: string
          daily_min: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alliance_id?: string | null
          board?: string
          daily_min?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "participation_thresholds_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "participation_thresholds_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "participation_thresholds_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
        ]
      }
      pets: {
        Row: {
          created_at: string
          name: string | null
          notes: string
          pet_id: number
          rarity: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          name?: string | null
          notes?: string
          pet_id: number
          rarity?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          name?: string | null
          notes?: string
          pet_id?: number
          rarity?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      player_claims: {
        Row: {
          alliance_id: string | null
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
          alliance_id?: string | null
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
          alliance_id?: string | null
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
            foreignKeyName: "player_claims_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "player_claims_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "player_claims_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
            foreignKeyName: "player_component_power_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "player_component_power_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            foreignKeyName: "player_detail_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "player_detail_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          alliance_id: string | null
          assigned_rank: string
          player_id: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          alliance_id?: string | null
          assigned_rank: string
          player_id: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          alliance_id?: string | null
          assigned_rank?: string
          player_id?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_ranks_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "player_ranks_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "player_ranks_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
      player_season_buildings_current: {
        Row: {
          game_uid: number
          level_since: Json
          levels: Json
          newest_seen: string | null
          oldest_seen: string | null
          player_id: string
          refreshed_at: string
          seen_at: Json
          server_id: number
        }
        Insert: {
          game_uid: number
          level_since?: Json
          levels?: Json
          newest_seen?: string | null
          oldest_seen?: string | null
          player_id: string
          refreshed_at?: string
          seen_at?: Json
          server_id: number
        }
        Update: {
          game_uid?: number
          level_since?: Json
          levels?: Json
          newest_seen?: string | null
          oldest_seen?: string | null
          player_id?: string
          refreshed_at?: string
          seen_at?: Json
          server_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_season_buildings_current_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_season_buildings_current_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "player_season_buildings_current_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
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
            foreignKeyName: "player_season_force_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "player_season_force_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_snapshots: {
        Row: {
          alliance_abbr: string | null
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
          alliance_abbr?: string | null
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
          alliance_abbr?: string | null
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
            foreignKeyName: "player_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "player_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "players_current_alliance_id_fkey"
            columns: ["current_alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
          {
            foreignKeyName: "players_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          alliance_id: string | null
          below_minimum: boolean
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
          lab_adjustment: number
          lab_level: number | null
          minimum_missed: string | null
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
          alliance_id?: string | null
          below_minimum?: boolean
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
          lab_adjustment?: number
          lab_level?: number | null
          minimum_missed?: string | null
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
          alliance_id?: string | null
          below_minimum?: boolean
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
          lab_adjustment?: number
          lab_level?: number | null
          minimum_missed?: string | null
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
            foreignKeyName: "rank_period_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "rank_period_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "rank_period_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
          alliance_id: string | null
          allowed: boolean
          capability: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          alliance_id?: string | null
          allowed?: boolean
          capability: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          alliance_id?: string | null
          allowed?: boolean
          capability?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "role_permissions_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "role_permissions_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
          alliance_id: string | null
          category: string
          channel: string | null
          colour: string | null
          created_at: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          alliance_id?: string | null
          category: string
          channel?: string | null
          colour?: string | null
          created_at?: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          alliance_id?: string | null
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
            foreignKeyName: "schedule_categories_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_categories_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_categories_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
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
          alliance_id: string | null
          body: string | null
          category: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          schedule_event_id: string
          series_id: string | null
          source: string
          source_key: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          alliance_id?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          schedule_event_id?: string
          series_id?: string | null
          source?: string
          source_key?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          alliance_id?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          schedule_event_id?: string
          series_id?: string | null
          source?: string
          source_key?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_events_category_fkey"
            columns: ["alliance_id", "category"]
            isOneToOne: false
            referencedRelation: "schedule_categories"
            referencedColumns: ["alliance_id", "category"]
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
            foreignKeyName: "season_building_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "season_building_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      season_buildings: {
        Row: {
          building_type_id: number
          name: string
          provisional: boolean
          season_id: number
          sort_order: number
          stall_hours: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          building_type_id: number
          name: string
          provisional?: boolean
          season_id: number
          sort_order?: number
          stall_hours?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          building_type_id?: number
          name?: string
          provisional?: boolean
          season_id?: number
          sort_order?: number
          stall_hours?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_buildings_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["season_id"]
          },
        ]
      }
      seasons: {
        Row: {
          ends_at: string | null
          name: string
          season_id: number
          starts_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ends_at?: string | null
          name: string
          season_id: number
          starts_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ends_at?: string | null
          name?: string
          season_id?: number
          starts_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
          {
            foreignKeyName: "servers_merged_into_server_id_fkey"
            columns: ["merged_into_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      shop_listing_snapshots: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          currency_id: string | null
          currency_kind: number | null
          discount: number | null
          idempotency_key: string
          item_id: string | null
          listing_id: string
          observation_id: string
          parser_version: string
          price: number
          qty: number
          raw: Json
          server_id: number
          shop_type: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          currency_id?: string | null
          currency_kind?: number | null
          discount?: number | null
          idempotency_key: string
          item_id?: string | null
          listing_id: string
          observation_id: string
          parser_version: string
          price: number
          qty?: number
          raw?: Json
          server_id: number
          shop_type: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          currency_id?: string | null
          currency_kind?: number | null
          discount?: number | null
          idempotency_key?: string
          item_id?: string | null
          listing_id?: string
          observation_id?: string
          parser_version?: string
          price?: number
          qty?: number
          raw?: Json
          server_id?: number
          shop_type?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_listing_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_listing_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_listing_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "shop_listing_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_listing_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      shop_pack_catalogs: {
        Row: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at: string
          idempotency_key: string
          observation_id: string
          pack_ids: Json
          parser_version: string
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
        }
        Insert: {
          captured_at: string
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          idempotency_key: string
          observation_id: string
          pack_ids?: Json
          parser_version: string
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
        }
        Update: {
          captured_at?: string
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          idempotency_key?: string
          observation_id?: string
          pack_ids?: Json
          parser_version?: string
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_pack_catalogs_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_catalogs_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_catalogs_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "shop_pack_catalogs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_catalogs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      shop_pack_snapshots: {
        Row: {
          captured_at: string
          claimed_percent: number | null
          collected_from_server_id: number
          collector_id: string
          created_at: string
          dollars: number
          ends_at: string | null
          idempotency_key: string
          items: Json
          name_key: string | null
          observation_id: string
          pack_id: string
          pack_type: string | null
          parser_version: string
          raw: Json
          rubies: number
          server_id: number
          snapshot_id: string
          source_command: string
          starts_at: string | null
        }
        Insert: {
          captured_at: string
          claimed_percent?: number | null
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          dollars: number
          ends_at?: string | null
          idempotency_key: string
          items?: Json
          name_key?: string | null
          observation_id: string
          pack_id: string
          pack_type?: string | null
          parser_version: string
          raw?: Json
          rubies?: number
          server_id: number
          snapshot_id?: string
          source_command: string
          starts_at?: string | null
        }
        Update: {
          captured_at?: string
          claimed_percent?: number | null
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          dollars?: number
          ends_at?: string | null
          idempotency_key?: string
          items?: Json
          name_key?: string | null
          observation_id?: string
          pack_id?: string
          pack_type?: string | null
          parser_version?: string
          raw?: Json
          rubies?: number
          server_id?: number
          snapshot_id?: string
          source_command?: string
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_pack_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "shop_pack_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      user_players: {
        Row: {
          created_at: string
          player_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          player_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          player_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "user_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "activity_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user_directory"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "post_authors"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "world_city_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          {
            foreignKeyName: "world_city_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      world_truck_snapshots: {
        Row: {
          alliance_abbr: string | null
          arrive_at: string | null
          captured_at: string
          cfg_id: number | null
          collected_from_server_id: number
          collector_id: string
          completeness: number | null
          created_at: string
          goods: Json | null
          hero_fragments: number | null
          idempotency_key: string
          observation_id: string
          owner_game_uid: string | null
          owner_name: string | null
          parser_version: string
          quality: number | null
          raw: Json
          rob_times: number | null
          segment_end_at: string | null
          segment_start_at: string | null
          send_at: string | null
          server_id: number
          snapshot_id: string
          source_command: string
          start_pos: number | null
          target_pos: number | null
          truck_uuid: string
        }
        Insert: {
          alliance_abbr?: string | null
          arrive_at?: string | null
          captured_at: string
          cfg_id?: number | null
          collected_from_server_id: number
          collector_id: string
          completeness?: number | null
          created_at?: string
          goods?: Json | null
          hero_fragments?: number | null
          idempotency_key: string
          observation_id: string
          owner_game_uid?: string | null
          owner_name?: string | null
          parser_version: string
          quality?: number | null
          raw?: Json
          rob_times?: number | null
          segment_end_at?: string | null
          segment_start_at?: string | null
          send_at?: string | null
          server_id: number
          snapshot_id?: string
          source_command: string
          start_pos?: number | null
          target_pos?: number | null
          truck_uuid: string
        }
        Update: {
          alliance_abbr?: string | null
          arrive_at?: string | null
          captured_at?: string
          cfg_id?: number | null
          collected_from_server_id?: number
          collector_id?: string
          completeness?: number | null
          created_at?: string
          goods?: Json | null
          hero_fragments?: number | null
          idempotency_key?: string
          observation_id?: string
          owner_game_uid?: string | null
          owner_name?: string | null
          parser_version?: string
          quality?: number | null
          raw?: Json
          rob_times?: number | null
          segment_end_at?: string | null
          segment_start_at?: string | null
          send_at?: string | null
          server_id?: number
          snapshot_id?: string
          source_command?: string
          start_pos?: number | null
          target_pos?: number | null
          truck_uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_truck_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "world_truck_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
        ]
      }
      world_viewport_snapshots: {
        Row: {
          captured_at: string
          center_x: number
          center_y: number
          collected_from_server_id: number
          collector_id: string
          created_at: string
          idempotency_key: string
          max_x: number | null
          max_y: number | null
          min_x: number | null
          min_y: number | null
          object_count: number
          observation_id: string
          parser_version: string
          raw: Json
          server_id: number
          snapshot_id: string
          source_command: string
          view_lvl: number | null
        }
        Insert: {
          captured_at: string
          center_x: number
          center_y: number
          collected_from_server_id: number
          collector_id: string
          created_at?: string
          idempotency_key: string
          max_x?: number | null
          max_y?: number | null
          min_x?: number | null
          min_y?: number | null
          object_count?: number
          observation_id: string
          parser_version: string
          raw?: Json
          server_id: number
          snapshot_id?: string
          source_command: string
          view_lvl?: number | null
        }
        Update: {
          captured_at?: string
          center_x?: number
          center_y?: number
          collected_from_server_id?: number
          collector_id?: string
          created_at?: string
          idempotency_key?: string
          max_x?: number | null
          max_y?: number | null
          min_x?: number | null
          min_y?: number | null
          object_count?: number
          observation_id?: string
          parser_version?: string
          raw?: Json
          server_id?: number
          snapshot_id?: string
          source_command?: string
          view_lvl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "world_viewport_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "world_viewport_snapshots_collected_from_server_id_fkey"
            columns: ["collected_from_server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "world_viewport_snapshots_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["collector_id"]
          },
          {
            foreignKeyName: "world_viewport_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "world_viewport_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
    }
    Views: {
      account_state_latest: {
        Row: {
          buildings: Json | null
          captured_at: string | null
          effects: Json | null
          game_uid: number | null
          hero_equips: Json | null
          hero_exclusives: Json | null
          hero_intensify: Json | null
          hero_levels: Json | null
          hero_squads: Json | null
          hero_trained: Json | null
          items: Json | null
          mod_car_equips: Json | null
          pets: Json | null
          player_id: string | null
          resources: Json | null
          science: Json | null
          server_id: number | null
          timed_effects: Json | null
          vehicle: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "account_state_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "account_state_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
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
        Insert: {
          display_name?: never
          user_id?: string | null
        }
        Update: {
          display_name?: never
          user_id?: string | null
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
        Relationships: []
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
          {
            foreignKeyName: "alliance_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "alliance_member_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
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
          {
            foreignKeyName: "alliance_member_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      app_user_directory: {
        Row: {
          alliance_role: Database["public"]["Enums"]["app_role"] | null
          created_at: string | null
          display_name: string | null
          email: string | null
          email_confirmed_at: string | null
          game_rank: string | null
          last_sign_in_at: string | null
          other_alliances: number | null
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
      black_money_battle_members: {
        Row: {
          alliance_external_id: string | null
          battle_ended_at: string | null
          collect_score: number | null
          escort_score: number | null
          first_occupy_score: number | null
          game_uid: number | null
          kill_score: number | null
          name: string | null
          occupy_score: number | null
          played: boolean | null
          player_id: string | null
          score: number | null
          slot: string | null
          team_index: number | null
        }
        Relationships: []
      }
      black_money_battle_opponents: {
        Row: {
          alliance_external_id: string | null
          battle_ended_at: string | null
          collect_score: number | null
          escort_score: number | null
          first_occupy_score: number | null
          game_uid: number | null
          kill_score: number | null
          name: string | null
          occupy_score: number | null
          opponent_abbr: string | null
          opponent_alliance_external_id: string | null
          player_id: string | null
          score: number | null
          server_id: number | null
          team_index: number | null
        }
        Relationships: [
          {
            foreignKeyName: "black_money_score_snapshots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_score_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      black_money_battles: {
        Row: {
          alliance_external_id: string | null
          alliance_id: string | null
          battle_ended_at: string | null
          enemy_abbr: string | null
          enemy_name: string | null
          enemy_score: number | null
          enemy_user_num: number | null
          max_user_num: number | null
          players_scored: number | null
          report_seen: boolean | null
          score: number | null
          server_id: number | null
          signup_read_at: string | null
          starters: number | null
          state: number | null
          substitutes: number | null
          team_index: number | null
          user_num: number | null
        }
        Relationships: [
          {
            foreignKeyName: "black_money_battle_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "black_money_battle_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      black_money_member_misses: {
        Row: {
          alliance_external_id: string | null
          game_uid: number | null
          player_id: string | null
          starter_battles: number | null
          starter_misses: number | null
          substitute_battles: number | null
          substitute_misses: number | null
        }
        Relationships: []
      }
      dispatch_missions_live: {
        Row: {
          alliance_abbr: string | null
          alliance_external_id: string | null
          color: number | null
          ends_at: string | null
          is_special: boolean | null
          mission_id: number | null
          mission_uuid: string | null
          orange_books: number | null
          owner_game_uid: number | null
          owner_name: string | null
          point_id: number | null
          seen_at: string | null
          server_id: number | null
          star: number | null
          started_at: string | null
          steal_items: Json | null
          steal_max: number | null
          x: number | null
          y: number | null
        }
        Relationships: []
      }
      event_schedule_current: {
        Row: {
          activity_id: string | null
          activity_type: number | null
          category: string | null
          detail: Json | null
          ends_at: string | null
          name: string | null
          need_hq_level: number | null
          seen_at: string | null
          server_id: number | null
          starts_at: string | null
          sub_type: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_schedule_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "event_schedule_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
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
      game_upgrade_materials: {
        Row: {
          id: string | null
          kinds: string[] | null
          type: string | null
        }
        Relationships: []
      }
      game_upgrade_subjects: {
        Row: {
          category: number | null
          kind: string | null
          max_level: number | null
          name: string | null
          name_ko: string | null
          subject_id: string | null
        }
        Relationships: []
      }
      hive_formation_board: {
        Row: {
          anchor_x: number | null
          anchor_y: number | null
          assigned_at: string | null
          assigned_by: string | null
          colour: string | null
          created_at: string | null
          dx: number | null
          dy: number | null
          formation_id: string | null
          formation_name: string | null
          game_uid: number | null
          hq_level: number | null
          is_active: boolean | null
          kind: string | null
          label: string | null
          ordinal: number | null
          pinned: boolean | null
          player_id: string | null
          player_name: string | null
          point_id: number | null
          power: number | null
          server_id: number | null
          slot_id: string | null
          span_x: number | null
          span_y: number | null
          still_a_member: boolean | null
          updated_at: string | null
          x: number | null
          y: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hive_formation_slots_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "pending_access"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "hive_formation_slots_formation_id_fkey"
            columns: ["formation_id"]
            isOneToOne: false
            referencedRelation: "hive_formations"
            referencedColumns: ["formation_id"]
          },
          {
            foreignKeyName: "hive_formation_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "hive_formations_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "hive_formations_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      hive_formation_template_list: {
        Row: {
          bases: number | null
          created_at: string | null
          name: string | null
          note: string | null
          structures: number | null
          template_id: string | null
          tiles: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      latest_world_cities: {
        Row: {
          captured_at: string | null
          game_uid: number | null
          hq_level: number | null
          name: string | null
          player_id: string | null
          point_id: number | null
          server_id: number | null
          x: number | null
          y: number | null
        }
        Relationships: [
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
          {
            foreignKeyName: "world_city_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      member_current_period_contribution: {
        Row: {
          current_name: string | null
          donation_total: number | null
          donation_week1: number | null
          donation_week2: number | null
          duel_total: number | null
          duel_week1: number | null
          duel_week2: number | null
          game_uid: number | null
          newest_reading_at: string | null
          period_start: string | null
          player_id: string | null
          week1_end: string | null
          week2_end: string | null
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
      member_roster: {
        Row: {
          assigned_rank: string | null
          below_minimum: boolean | null
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
      member_season_buildings: {
        Row: {
          building_type_id: number | null
          captured_at: string | null
          current_name: string | null
          game_uid: number | null
          level: number | null
          object_id: number | null
          player_id: string | null
          server_id: number | null
          x: number | null
          y: number | null
        }
        Relationships: [
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
          {
            foreignKeyName: "season_building_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      member_season_buildings_by_member: {
        Row: {
          current_name: string | null
          game_uid: number | null
          level_since: Json | null
          levels: Json | null
          newest_seen: string | null
          oldest_seen: string | null
          player_id: string | null
          seen_at: Json | null
          server_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_season_buildings_current_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["player_id"]
          },
          {
            foreignKeyName: "player_season_buildings_current_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "player_season_buildings_current_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
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
          requested_alliance_id: string | null
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
          {
            foreignKeyName: "player_component_power_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      player_current_rank: {
        Row: {
          assigned_rank: string | null
          below_minimum: boolean | null
          computed_reason: string | null
          computed_tier: string | null
          donation_pct: number | null
          duel_pct: number | null
          growth_pct: number | null
          minimum_missed: string | null
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
          {
            foreignKeyName: "player_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
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
          below_minimum: boolean | null
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
          lab_adjustment: number | null
          lab_level: number | null
          minimum_missed: string | null
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
          alliance_id: string | null
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
            foreignKeyName: "schedule_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_daily_contribution"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliance_departures"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_events_alliance_id_fkey"
            columns: ["alliance_id"]
            isOneToOne: false
            referencedRelation: "alliances"
            referencedColumns: ["alliance_id"]
          },
          {
            foreignKeyName: "schedule_events_category_fkey"
            columns: ["alliance_id", "category"]
            isOneToOne: false
            referencedRelation: "schedule_categories"
            referencedColumns: ["alliance_id", "category"]
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
      shop_listing_value: {
        Row: {
          captured_at: string | null
          discount: number | null
          item_id: string | null
          listing_id: string | null
          name: string | null
          name_ko: string | null
          price: number | null
          qty: number | null
          server_id: number | null
          shop_type: number | null
          unit_rubies: number | null
          value_ratio: number | null
          value_source: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_listing_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_listing_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      shop_pack_catalog_latest: {
        Row: {
          captured_at: string | null
          pack_ids: Json | null
          server_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_pack_catalogs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_catalogs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      shop_pack_value: {
        Row: {
          captured_at: string | null
          claimed_percent: number | null
          contents: Json | null
          contents_listed: boolean | null
          dollars: number | null
          ends_at: string | null
          item_rubies: number | null
          name: string | null
          name_key: string | null
          name_ko: string | null
          pack_id: string | null
          pack_type: string | null
          rubies: number | null
          server_id: number | null
          starts_at: string | null
          unvalued_items: number | null
          value_dollars: number | null
          value_ratio: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_pack_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servers"
            referencedColumns: ["server_id"]
          },
          {
            foreignKeyName: "shop_pack_snapshots_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "world_sweep_coverage"
            referencedColumns: ["server_id"]
          },
        ]
      }
      swept_servers: {
        Row: {
          server_id: number | null
          swept_at: string | null
        }
        Relationships: []
      }
      sync_status: {
        Row: {
          is_live: boolean | null
          last_heartbeat_at: string | null
        }
        Relationships: []
      }
      world_sweep_coverage: {
        Row: {
          cell_size: number | null
          cells_never_seen: number | null
          cells_seen: number | null
          cells_total: number | null
          gaps: Json | null
          newest_seen_at: string | null
          oldest_seen_at: string | null
          seen_cells: Json | null
          server_id: number | null
        }
        Relationships: []
      }
      world_trucks_latest: {
        Row: {
          alliance_abbr: string | null
          arrive_at: string | null
          cargo_seen_at: string | null
          cfg_id: number | null
          completeness: number | null
          goods: Json | null
          hero_fragments: number | null
          owner_game_uid: string | null
          owner_name: string | null
          position_seen_at: string | null
          quality: number | null
          rob_times: number | null
          segment_end_at: string | null
          segment_start_at: string | null
          server_id: number | null
          start_pos: number | null
          target_pos: number | null
          truck_uuid: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_in_view: { Args: { p_user: string }; Returns: boolean }
      account_name_in_view: { Args: { p_user: string }; Returns: string }
      active_alliance: { Args: never; Returns: string }
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
      add_gift_code: { Args: { p_code: string }; Returns: string }
      alliance_role_of: {
        Args: { p_user: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      alliance_setting: {
        Args: { p_alliance?: string; p_key: string }
        Returns: Json
      }
      announce_rank_period: { Args: never; Returns: string }
      approve_player_claim: {
        Args: { p_user: string }
        Returns: {
          alliance_id: string | null
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
      assign_hive_formation_slots: {
        Args: { p_assignments: Json; p_formation_id: string }
        Returns: Json
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
      can_enter_account: { Args: { p_player_id: string }; Returns: boolean }
      cancel_gift_claims: { Args: { p_code_id: string }; Returns: number }
      claim_player: {
        Args: { p_player_id: string }
        Returns: {
          alliance_id: string | null
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
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      declare_event_day: {
        Args: {
          p_declared?: boolean
          p_held_on: string
          p_kind: string
          p_note?: string
        }
        Returns: undefined
      }
      delete_gift_code: { Args: { p_code_id: string }; Returns: number }
      delete_season_building: {
        Args: { p_building_type_id: number; p_season_id: number }
        Returns: undefined
      }
      enqueue_gift_claims: {
        Args: { p_code_ids: string[]; p_game_uids?: number[] }
        Returns: number
      }
      enter_weekly_scores: {
        Args: { p_entries: Json; p_week_start: string }
        Returns: number
      }
      epoch_ms_to_timestamptz: { Args: { p_ms: Json }; Returns: string }
      freeze_alliance_settings: {
        Args: { p_old_primary?: string }
        Returns: undefined
      }
      gift_code_progress: {
        Args: never
        Returns: {
          already: number
          checked_at: string
          code: string
          code_id: string
          done: number
          failed: number
          first_seen_at: string
          members: number
          other: number
          queued: number
          running: number
          source: string
          status: string
        }[]
      }
      gift_member_status: {
        Args: never
        Returns: {
          claims: Json
          excluded: boolean
          game_uid: number
          name: string
        }[]
      }
      gift_runner_status: {
        Args: never
        Returns: {
          enabled: boolean
          halted_reason: string
          last_sent_at: string
          paused_until: string
        }[]
      }
      has_permission: { Args: { p_capability: string }; Returns: boolean }
      is_service_request: { Args: never; Returns: boolean }
      joinable_alliances: {
        Args: never
        Returns: {
          alliance_id: string
          code: string
          name: string
          server_id: number
        }[]
      }
      leave_active_alliance: { Args: never; Returns: undefined }
      leave_alliance: { Args: never; Returns: undefined }
      linked_player_id: { Args: never; Returns: string }
      linked_player_ids: { Args: never; Returns: string[] }
      member_participation: {
        Args: {
          p_donation_min?: number
          p_duel_min?: number
          p_from: string
          p_to: string
        }
        Returns: {
          black_gold_listed: number
          black_gold_played: number
          black_gold_starter_missed: number
          black_gold_substitute_missed: number
          current_name: string
          donation_days_on_board: number
          donation_days_over: number
          donation_days_read: number
          donation_days_scored: number
          donation_total: number
          donation_weeks_on_board: number
          donation_weeks_read: number
          donation_weeks_scored: number
          duel_days_on_board: number
          duel_days_over: number
          duel_days_read: number
          duel_days_scored: number
          duel_total: number
          duel_weeks_on_board: number
          duel_weeks_read: number
          duel_weeks_scored: number
          game_uid: number
          member_rank: number
          player_id: string
          season_levels_gained: number
          typed_events: Json
          watchtower_gained: number
          watchtower_level: number
        }[]
      }
      migration_alliances: {
        Args: { p_event_id: string }
        Returns: {
          after_server_id: number
          before_server_id: number
          board_members_after: number
          board_members_before: number
          board_power_after: number
          board_power_before: number
          code: string
          external_id: string
          joined: number
          left_alliance: number
          left_by_moving: number
          members_after: number
          members_before: number
          name: string
          roster_after_at: string
          roster_before_at: string
          roster_power_after: number
          roster_power_before: number
          stayed: number
        }[]
      }
      migration_flows: {
        Args: { p_event_id: string }
        Returns: {
          from_server_id: number
          movers: number
          power: number
          to_server_id: number
          top_movers: number
        }[]
      }
      migration_people: {
        Args: { p_event_id: string }
        Returns: {
          after_alliance: string
          after_at: string
          after_power: number
          after_rank: number
          after_server_id: number
          before_alliance: string
          before_at: string
          before_power: number
          before_rank: number
          before_server_id: number
          game_uid: number
          home_server_id: number
          name: string
          player_id: string
          status: string
        }[]
      }
      migration_roster_reads: {
        Args: { p_event_id: string }
        Returns: {
          after_at: string
          before_at: string
          external_id: string
        }[]
      }
      migration_server_quotas: {
        Args: never
        Returns: {
          captured_at: string
          invite_left: Json
          king_name: string
          max_power: number
          migrate_left: Json
          need_item_id: number
          need_item_num: number
          power_limit: number
          power_low_limit: number[]
          season: number
          season_group: number
          server_id: number
          server_rank_type: number
          special_left: Json
          special_power_limit: number
          target_open_at: string
          target_power_limit: number
          total_count: number
          use_count: number
        }[]
      }
      migration_servers: {
        Args: { p_event_id: string }
        Returns: {
          appeared: number
          moved_in: number
          moved_out: number
          power_in: number
          power_out: number
          server_id: number
          stayed: number
          top_after: number
          top_before: number
          top_power_after: number
          top_power_before: number
          tracked_after: number
          tracked_before: number
          unseen_after: number
        }[]
      }
      migration_top_board: {
        Args: { p_event_id: string }
        Returns: {
          after_alliance: string
          after_at: string
          after_power: number
          after_rank: number
          after_server_id: number
          before_alliance: string
          before_at: string
          before_power: number
          before_rank: number
          before_server_id: number
          game_uid: number
          home_server_id: number
          name: string
          player_id: string
          status: string
        }[]
      }
      my_alliances: {
        Args: never
        Returns: {
          alliance_id: string
          code: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
          server_id: number
        }[]
      }
      name_unnamed_season_buildings: {
        Args: { p_season_id: number }
        Returns: number
      }
      notification_channel_alliance: {
        Args: { p_channel: string }
        Returns: string
      }
      primary_own_alliance: { Args: never; Returns: string }
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
      recommend_step_pairs: {
        Args: { p_buildings: Json; p_science: Json }
        Returns: Json
      }
      record_departure: {
        Args: { p_action: string; p_user: string }
        Returns: undefined
      }
      record_event_attendance: {
        Args: { p_entries: Json; p_held_on: string; p_kind: string }
        Returns: number
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
      refresh_member_roster_players: {
        Args: { p_players: string[] }
        Returns: undefined
      }
      refresh_player_season_buildings: {
        Args: { p_players?: string[] }
        Returns: undefined
      }
      refuse_other_alliance: {
        Args: { p_alliance: string }
        Returns: undefined
      }
      reject_player_claim: {
        Args: { p_user: string }
        Returns: {
          alliance_id: string | null
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
      research_prerequisite_steps: {
        Args: { p_subjects: string[] }
        Returns: Json
      }
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
      save_alliance_setting: {
        Args: { p_key: string; p_value: Json }
        Returns: undefined
      }
      save_event_kind: {
        Args: {
          p_archived?: boolean
          p_board: string
          p_kind: string
          p_label: string
          p_sort_order?: number
        }
        Returns: undefined
      }
      save_hive_formation_layout: {
        Args: { p_formation_id: string; p_slots: Json }
        Returns: Json
      }
      save_hive_formation_template: {
        Args: { p_name: string; p_note: string; p_slots: Json }
        Returns: string
      }
      save_season: {
        Args: {
          p_ends_at?: string
          p_name: string
          p_season_id: number
          p_starts_at?: string
        }
        Returns: undefined
      }
      save_season_building: {
        Args: {
          p_building_type_id: number
          p_name: string
          p_provisional?: boolean
          p_season_id: number
          p_sort_order?: number
          p_stall_hours?: number
        }
        Returns: undefined
      }
      season_unnamed_buildings: {
        Args: never
        Returns: {
          building_type_id: number
          game_name: string
          newest_seen: string
          players: number
        }[]
      }
      set_gift_code_status: {
        Args: { p_code_id: string; p_status: string }
        Returns: undefined
      }
      set_gift_exclusion: {
        Args: { p_excluded: boolean; p_game_uid: number }
        Returns: undefined
      }
      set_gift_runner_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      set_membership: {
        Args: {
          p_alliance: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_user: string
        }
        Returns: undefined
      }
      set_participation_threshold: {
        Args: { p_board: string; p_daily_min: number }
        Returns: undefined
      }
      set_roster_membership: {
        Args: { p_member: boolean; p_player_id: string }
        Returns: number
      }
      tier_rank: { Args: { p_tier: string }; Returns: number }
      unlink_player: { Args: { p_player_id: string }; Returns: undefined }
      waiting_to_join: {
        Args: never
        Returns: {
          created_at: string
          email: string
          last_sign_in_at: string
          requested_alliance_id: string
          user_id: string
        }[]
      }
      week_scores: {
        Args: { p_week_start: string }
        Returns: {
          current_name: string
          donation: number
          donation_typed: boolean
          duel: number
          duel_typed: boolean
          player_id: string
        }[]
      }
      world_cities_in_box: {
        Args: {
          p_server_id: number
          p_x_max: number
          p_x_min: number
          p_y_max: number
          p_y_min: number
        }
        Returns: {
          captured_at: string
          game_uid: number
          hq_level: number
          name: string
          player_id: string
          x: number
          y: number
        }[]
      }
      world_viewport_half_extent: {
        Args: never
        Returns: {
          half_x: number
          half_y: number
        }[]
      }
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

