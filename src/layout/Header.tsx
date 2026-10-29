import * as Menu from '@radix-ui/react-dropdown-menu'
import { Bell, Building2, Check, LogOut, Menu as MenuIcon, Monitor, Moon, Search, Sun } from 'lucide-react'
import { useAuth } from '@/core/auth/useAuth'
import { useCompany } from '@/core/company/useCompany'
import { roleLabels } from '@/core/permissions/permissions'
import { useTheme } from '@/core/theme/useTheme'
import type { ThemePreference } from '@/core/theme/theme'

const menuContent =
  'surface z-50 min-w-56 rounded-md p-1 text-sm shadow-lg data-[side=bottom]:mt-1'
const menuItem =
  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--surface-muted)]'

const themes: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Do sistema', Icon: Monitor },
]

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, signOut } = useAuth()
  const { memberships, active, selectCompany } = useCompany()
  const { preference, setTheme } = useTheme()
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  const initials = name
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-[var(--surface)] px-4">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded p-1.5 hover:bg-black/5 lg:hidden dark:hover:bg-white/10"
        aria-label="Abrir menu"
      >
        <MenuIcon className="size-5" />
      </button>

      <Menu.Root>
        <Menu.Trigger className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10">
          <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="truncate">{active?.company.name}</span>
          <span className="sr-only">Trocar empresa</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" className={menuContent}>
            <Menu.Label className="px-2 py-1 text-xs text-muted">Suas empresas</Menu.Label>
            {memberships.map((m) => (
              <Menu.Item key={m.company.id} className={menuItem} onSelect={() => selectCompany(m.company.id)}>
                <Check className={m.company.id === active?.company.id ? 'size-4' : 'invisible size-4'} />
                <span className="flex-1 truncate">{m.company.name}</span>
                <span className="text-xs text-muted">{roleLabels[m.role]}</span>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <div className="ml-auto hidden max-w-sm flex-1 md:block">
        <label className="relative block">
          <span className="sr-only">Pesquisa global (disponível na Fase 2)</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            disabled
            placeholder="Pesquisa global chega com clientes e OS (Fase 2)"
            className="h-9 w-full cursor-not-allowed rounded-md border border-line bg-[var(--surface-muted)] pr-3 pl-9 text-sm placeholder:text-muted"
          />
        </label>
      </div>

      <button
        type="button"
        disabled
        title="Notificações chegam com as automações (Fase 4)"
        aria-label="Notificações (indisponível até a Fase 4)"
        className="ml-auto cursor-not-allowed rounded p-2 text-muted opacity-60 md:ml-0"
      >
        <Bell className="size-5" />
      </button>

      <Menu.Root>
        <Menu.Trigger
          aria-label="Menu do usuário"
          className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white dark:bg-navy-600"
        >
          {initials || '?'}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" className={menuContent}>
            <div className="px-2 py-1.5">
              <p className="truncate font-medium">{name}</p>
              {active && <p className="text-xs text-muted">{roleLabels[active.role]}</p>}
            </div>
            <Menu.Separator className="my-1 h-px bg-[var(--border)]" />
            <Menu.Label className="px-2 py-1 text-xs text-muted">Tema</Menu.Label>
            <Menu.RadioGroup value={preference} onValueChange={(v) => setTheme(v as ThemePreference)}>
              {themes.map(({ value, label, Icon }) => (
                <Menu.RadioItem key={value} value={value} className={menuItem}>
                  <Icon className="size-4" />
                  <span className="flex-1">{label}</span>
                  <Menu.ItemIndicator>
                    <Check className="size-4" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="my-1 h-px bg-[var(--border)]" />
            <Menu.Item className={menuItem} onSelect={() => void signOut()}>
              <LogOut className="size-4" />
              Sair
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </header>
  )
}
