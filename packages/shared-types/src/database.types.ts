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
          created_at: string
          created_by: string | null
          ends_at: string | null
          pinned: boolean
          starts_at: string | null
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          announcement_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          pinned?: boolean
          starts_at?: string | null
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          announcement_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          pinned?: boolean
          starts_at?: string | null
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: []
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
        Relationships: []
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
            referencedRelation: "app_users"
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
          created_at: string
          favourite_id: string
          player_id: string | null
          server_id: number | null
          user_id: string
        }
        Insert: {
          alliance_id?: string | null
          created_at?: string
          favourite_id?: string
          player_id?: string | null
          server_id?: number | null
          user_id: string
        }
        Update: {
          alliance_id?: string | null
          created_at?: string
          favourite_id?: string
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
        Relationships: []
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
            referencedRelation: "app_users"
            referencedColumns: ["user_id"]
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
      player_component_power_snapshots: {
        Row: {
          alliance_abbr: string | null
          alliance_name: string | null
          board_type: number
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
          board_type: number
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
          board_type?: number
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
            referencedRelation: "app_users"
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
    }
    Views: {
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
      sync_status: {
        Row: {
          is_live: boolean | null
          last_heartbeat_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
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
      linked_player_id: { Args: never; Returns: string }
      rank_period_start: { Args: { ts: string }; Returns: string }
      rank_period_week_ends: {
        Args: { period_start: string }
        Returns: string[]
      }
      redeem_join_code: {
        Args: { p_code: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      reset_week_start: { Args: { ts: string }; Returns: string }
      resolve_own_alliance: { Args: never; Returns: undefined }
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

