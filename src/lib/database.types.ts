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
          created_by: string | null
          created_at: Timestamp
          updated_at: Timestamp
        }
        Insert: never
        Update: {
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
    }
    Views: { [_ in never]: never }
    Functions: {
      my_permissions: { Args: { p_company_id: string }; Returns: string[] }
      create_company: { Args: { p_name: string; p_legal_name?: string | null }; Returns: string }
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
        Returns: { kind: 'client' | 'equipment'; id: string; code: number; title: string; subtitle: string }[]
      }
    }
    Enums: {
      member_role: MemberRole
      member_status: MemberStatus
      client_kind: ClientKind
      contact_channel: ContactChannel
    }
    CompositeTypes: { [_ in never]: never }
  }
}
