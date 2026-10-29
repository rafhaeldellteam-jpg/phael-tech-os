/**
 * Tipos do banco no formato gerado pelo Supabase CLI.
 * Escrito à mão na Fase 1 a partir das migrações; regenere com
 * `npm run db:types` depois de `supabase start` e substitua este arquivo.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type MemberRole = 'admin' | 'technician' | 'finance' | 'attendant'
export type MemberStatus = 'active' | 'suspended'
export type ClientKind = 'person' | 'company'
export type ContactChannel = 'whatsapp' | 'phone' | 'email'
export type ServiceMode = 'bench' | 'remote' | 'onsite'
export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent'
export type OrderEventKind = 'created' | 'status' | 'assigned' | 'note' | 'updated'
export type OrderStage = 'open' | 'waiting' | 'working' | 'ready' | 'done' | 'stopped'

type Timestamp = string

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string
          name: string
          legal_name: string | null
          tax_id: string | null
          email: string | null
          phone: string | null
          timezone: string
          currency: string
          intake_terms: string | null
          delivery_terms: string | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: {
          intake_terms?: string | null
          delivery_terms?: string | null
          name?: string
          legal_name?: string | null
          tax_id?: string | null
          email?: string | null
          phone?: string | null
          timezone?: string
        }
        Relationships: []
      }
      profiles: {
        Row: { id: string; full_name: string | null; created_at: Timestamp; updated_at: Timestamp }
        Insert: never
        Update: { full_name?: string | null }
        Relationships: []
      }
      company_members: {
        Row: {
          id: string
          company_id: string
          user_id: string
          role: MemberRole
          status: MemberStatus
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'company_members_company_id_fkey'
            columns: ['company_id']
            isOneToOne: false
            referencedRelation: 'companies'
            referencedColumns: ['id']
          },
        ]
      }
      permissions: {
        Row: { key: string; module: string; description: string }
        Insert: never
        Update: never
        Relationships: []
      }
      role_permissions: {
        Row: { role: MemberRole; permission_key: string }
        Insert: never
        Update: never
        Relationships: []
      }
      member_permission_overrides: {
        Row: {
          member_id: string
          company_id: string
          permission_key: string
          granted: boolean
          created_by: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          company_id: string
          actor_id: string | null
          action: string
          entity: string
          entity_id: string | null
          changes: Json
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      company_invitations: {
        Row: {
          id: string
          company_id: string
          email: string
          role: MemberRole
          invited_by: string | null
          expires_at: Timestamp
          accepted_at: Timestamp | null
          accepted_by: string | null
          revoked_at: Timestamp | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          company_id: string
          code: number
          kind: ClientKind
          name: string
          trade_name: string | null
          email: string | null
          phone: string | null
          whatsapp: string | null
          preferred_channel: ContactChannel | null
          zip_code: string | null
          street: string | null
          street_number: string | null
          complement: string | null
          district: string | null
          city: string | null
          state: string | null
          marketing_consent: boolean
          consent_updated_at: Timestamp | null
          has_tax_id: boolean
          search_text: string
          archived_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      client_sensitive: {
        Row: {
          client_id: string
          company_id: string
          tax_id: string | null
          internal_notes: string | null
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
      equipment_types: {
        Row: { key: string; label: string; sort: number }
        Insert: never
        Update: never
        Relationships: []
      }
      equipment: {
        Row: {
          id: string
          company_id: string
          client_id: string
          code: number
          type: string
          manufacturer: string | null
          model: string | null
          serial_number: string | null
          asset_tag: string | null
          processor: string | null
          memory: string | null
          storage: string | null
          graphics: string | null
          operating_system: string | null
          condition_notes: string | null
          accessories: string[]
          search_text: string
          archived_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'equipment_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'equipment_type_fkey'
            columns: ['type']
            isOneToOne: false
            referencedRelation: 'equipment_types'
            referencedColumns: ['key']
          },
        ]
      }
      service_order_statuses: {
        Row: { key: string; label: string; stage: OrderStage; sort: number; is_final: boolean }
        Insert: never
        Update: never
        Relationships: []
      }
      service_order_transitions: {
        Row: { from_status: string; to_status: string; requires_reason: boolean }
        Insert: never
        Update: never
        Relationships: []
      }
      service_orders: {
        Row: {
          id: string
          company_id: string
          number: number
          client_id: string
          equipment_id: string | null
          mode: ServiceMode
          status: string
          priority: OrderPriority
          assigned_to: string | null
          reported_problem: string
          symptoms: string | null
          intake_condition: string | null
          intake_accessories: string[]
          device_password_note: string | null
          due_at: Timestamp | null
          received_at: Timestamp
          ready_at: Timestamp | null
          delivered_at: Timestamp | null
          closed_at: Timestamp | null
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'service_orders_company_id_client_id_fkey'
            columns: ['company_id', 'client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'service_orders_company_id_equipment_id_fkey'
            columns: ['company_id', 'equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['company_id', 'id']
          },
          {
            foreignKeyName: 'service_orders_status_fkey'
            columns: ['status']
            isOneToOne: false
            referencedRelation: 'service_order_statuses'
            referencedColumns: ['key']
          },
        ]
      }
      service_order_events: {
        Row: {
          id: number
          company_id: string
          order_id: string
          kind: OrderEventKind
          from_status: string | null
          to_status: string | null
          reason: string | null
          note: string | null
          assigned_to: string | null
          actor_id: string | null
          created_at: Timestamp
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      my_permissions: { Args: { p_company_id: string }; Returns: string[] }
      create_company: { Args: { p_name: string; p_legal_name?: string | null }; Returns: string }
      can_create_company: { Args: Record<string, never>; Returns: boolean }
      update_member: {
        Args: { p_member_id: string; p_role: MemberRole; p_status: MemberStatus }
        Returns: undefined
      }
      set_member_permission: {
        Args: { p_member_id: string; p_permission_key: string; p_granted: boolean | null }
        Returns: undefined
      }
      create_invitation: {
        Args: { p_company_id: string; p_email: string; p_role: MemberRole; p_valid_days?: number }
        Returns: string
      }
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      list_company_members: {
        Args: { p_company_id: string }
        Returns: {
          member_id: string
          user_id: string
          full_name: string | null
          email: string
          role: MemberRole
          status: MemberStatus
          created_at: Timestamp
        }[]
      }
      find_client_duplicates: {
        Args: {
          p_company_id: string
          p_name: string
          p_email?: string | null
          p_phone?: string | null
          p_tax_id?: string | null
          p_exclude_id?: string | null
        }
        Returns: { id: string; code: number; name: string; reason: string }[]
      }
      save_client: {
        Args: { p_company_id: string; p_client_id: string | null; p_data: Json; p_sensitive?: Json }
        Returns: string
      }
      set_client_archived: { Args: { p_client_id: string; p_archived: boolean }; Returns: undefined }
      export_clients: {
        Args: { p_company_id: string; p_include_archived?: boolean }
        Returns: {
          code: number
          kind: ClientKind
          name: string
          trade_name: string | null
          tax_id: string | null
          email: string | null
          phone: string | null
          whatsapp: string | null
          zip_code: string | null
          street: string | null
          street_number: string | null
          complement: string | null
          district: string | null
          city: string | null
          state: string | null
          marketing_consent: boolean
          created_at: Timestamp
        }[]
      }
      save_equipment: {
        Args: { p_company_id: string; p_equipment_id: string | null; p_data: Json }
        Returns: string
      }
      set_equipment_archived: { Args: { p_equipment_id: string; p_archived: boolean }; Returns: undefined }
      global_search: {
        Args: { p_company_id: string; p_query: string }
        Returns: { kind: 'client' | 'equipment' | 'order'; id: string; code: number; title: string; subtitle: string }[]
      }
      create_service_order: { Args: { p_company_id: string; p_data: Json }; Returns: string }
      update_service_order: { Args: { p_order_id: string; p_data: Json }; Returns: undefined }
      change_service_order_status: {
        Args: { p_order_id: string; p_to: string; p_reason?: string | null }
        Returns: undefined
      }
      assign_service_order: { Args: { p_order_id: string; p_user_id: string | null }; Returns: undefined }
      add_service_order_note: { Args: { p_order_id: string; p_note: string }; Returns: undefined }
      list_assignable_members: {
        Args: { p_company_id: string }
        Returns: { user_id: string; full_name: string | null; email: string; role: MemberRole }[]
      }
      service_order_stats: {
        Args: { p_company_id: string }
        Returns: { status: string; total: number; overdue: number }[]
      }
    }
    Enums: {
      member_role: MemberRole
      member_status: MemberStatus
      client_kind: ClientKind
      contact_channel: ContactChannel
      service_mode: ServiceMode
      order_priority: OrderPriority
      order_event_kind: OrderEventKind
    }
    CompositeTypes: { [_ in never]: never }
  }
}
