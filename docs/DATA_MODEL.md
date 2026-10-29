# Modelo de dados

## Fase 1 (implementado)

```
auth.users ─1:1─ profiles
     │
     └─1:N─ company_members ─N:1─ companies ─1:N─ audit_log
                 │                    │
                 │                    ├─1:N─ company_invitations
                 │                    └─1:N─ company_counters
                 └─1:N─ member_permission_overrides ─N:1─ permissions ─1:N─ role_permissions
```

| Tabela | Finalidade | Escrita pelo navegador |
|---|---|---|
| `companies` | Empresa (tenant): nome, razão social, CPF/CNPJ, contatos | UPDATE de colunas permitidas, com `company.update` |
| `profiles` | Nome do usuário (criado por trigger no cadastro) | UPDATE do próprio `full_name` |
| `company_members` | Usuário ↔ empresa, papel e situação | Não (RPC `update_member`) |
| `permissions` | Catálogo de permissões | Não |
| `role_permissions` | Permissões padrão de cada papel | Não |
| `member_permission_overrides` | Concessões/revogações por pessoa | Não (RPC `set_member_permission`) |
| `company_invitations` | Convites com hash SHA-256 do token e validade | Não (RPCs de convite) |
| `audit_log` | Trilha imutável | Nunca |
| `company_counters` | Último número por empresa e tipo de documento | Nunca |

### RPCs
| Função | Permissão | O que faz |
|---|---|---|
| `create_company(nome, razão)` | usuário autenticado (máx. 3 empresas criadas) | Cria a empresa e torna o autor administrador |
| `my_permissions(empresa)` | membro ativo | Lista permissões efetivas (para a interface) |
| `list_company_members(empresa)` | `members.read` | Membros com nome e e-mail |
| `update_member(membro, papel, situação)` | `members.manage` | Altera papel/situação; protege o último admin |
| `set_member_permission(membro, permissão, true/false/null)` | `members.manage` | Exceção por pessoa (null volta ao padrão) |
| `create_invitation(empresa, e-mail, papel, dias)` | `members.manage` | Gera token (devolvido uma única vez); 20/dia |
| `revoke_invitation(convite)` | `members.manage` | Cancela convite pendente |
| `accept_invitation(token)` | e-mail da conta = e-mail convidado | Entra na empresa |

## Fase 2 — clientes e equipamentos (implementado)

| Tabela | Finalidade | Leitura | Escrita |
|---|---|---|---|
| `clients` | Cadastro PF/PJ, contatos, endereço, consentimento, `code` sequencial, `has_tax_id` | `clients.read` | RPC `save_client` (`clients.write`) |
| `client_sensitive` | CPF/CNPJ (único por empresa) e observações internas | `clients.read_sensitive` | RPC `save_client`; quem não vê dados sensíveis só pode **informar** CPF/CNPJ novo |
| `equipment_types` | Tipos de equipamento | todos | — |
| `equipment` | Equipamento do cliente (FK composta `company_id, client_id`), série única entre ativos | `equipment.read` | RPC `save_equipment` (`equipment.write`) |

RPCs: `find_client_duplicates`, `save_client`, `set_client_archived`, `export_clients` (audita a exportação),
`save_equipment`, `set_equipment_archived`, `global_search`.
Não há exclusão de clientes/equipamentos: são arquivados para preservar histórico.

## Fase 2 — ordens de serviço (implementado)

| Tabela | Finalidade |
|---|---|
| `service_order_statuses` | 14 status com etapa (`open`, `working`, `waiting`, `ready`, `done`, `stopped`) |
| `service_order_transitions` | De → para permitidos e se exigem motivo |
| `service_orders` | OS: número, cliente, equipamento (FK composta), modo, status, prioridade, responsável, problema, entrada, prazos |
| `service_order_events` | Linha do tempo imutável (criação, status, atribuição, observação, edição) |

RPCs: `create_service_order`, `update_service_order`, `change_service_order_status`, `assign_service_order`,
`add_service_order_note`, `list_assignable_members`, `service_order_stats`.
Visibilidade: `orders.read_all` ou (`orders.read_assigned` e responsável = usuário). `orders.deliver` permite ao
atendente registrar entrega/devolução sem acesso ao resto do andamento.

## Fase 2 — próximos (planejado)

```
companies
 ├── service_orders (number via next_number, client_id, equipment_id, status,
 │     │             priority, assigned_to, due_at, intake_terms, delivery_terms)
 │     ├── service_order_events (status anterior/novo, autor, motivo, data)
 │     ├── service_order_attachments (Storage privado, URLs assinadas curtas)
 │     ├── diagnostics (inicial/final) ── diagnostic_items (procedimento, resultado, evidência)
 │     └── quotes (number, versão, validade, condições, status)
 │            ├── quote_items (serviço/peça, qtd, preço unitário, custo interno, desconto)
 │            └── quote_decisions (aprovado/recusado, forma, data, quem registrou)
 └── checklist_templates (por tipo de equipamento/serviço)
```

Regras previstas para a Fase 2:
- **Transições de status da OS** em uma tabela `service_order_transitions`
  (de → para, exige motivo?) configurável por empresa, validada por trigger.
- **Orçamento aprovado é imutável**: qualquer mudança cria nova versão com
  status "aguardando aprovação"; trigger impede UPDATE em versões aprovadas.
- **Técnico** vê apenas OS onde `assigned_to = auth.uid()`, salvo `orders.read_all`.
- **CPF/CNPJ do cliente** em coluna lida apenas via view/RPC que exige
  `clients.read_sensitive`.

## Fases 3–5
Estoque (`stock_items`, `stock_movements` com saldo por trigger e `SELECT … FOR UPDATE`),
financeiro (`receivables`, `payables`, `payments`, `refunds` — estornos geram
lançamentos inversos, nunca apagam), garantias, agenda, contratos, sites,
automações (`automation_runs` com chave de idempotência) e planos SaaS.
