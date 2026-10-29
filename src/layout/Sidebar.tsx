import { ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { NavLink } from 'react-router'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { cn } from '@/components/ui/cn'
import { useCompany } from '@/core/company/useCompany'
import { isAvailable, visibleNavigation } from '@/core/permissions/navigation'

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}) {
  const { permissions } = useCompany()
  const sections = visibleNavigation(permissions)

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-navy-950/60 lg:hidden" onClick={onCloseMobile} aria-hidden />
      )}
      <aside
        aria-label="Menu principal"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-navy-900 text-navy-100 transition-[width,transform] lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
          collapsed ? 'lg:w-[68px]' : 'lg:w-64',
          mobileOpen ? 'w-72 translate-x-0' : 'w-72 -translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-navy-700 px-4">
          <BrandLogo variant="full" className={cn('w-36', collapsed && 'lg:hidden')} />
          <BrandLogo variant="shield" className={cn('hidden size-9', collapsed && 'lg:block')} />
          <span className="sr-only">Phael Tech OS</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded p-1 hover:bg-white/10 lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {sections.map((section) => (
            <div key={section.label} className="mb-4">
              <p className={cn('px-3 pb-1 text-xs text-navy-300', collapsed && 'lg:sr-only')}>{section.label}</p>
              <ul className="grid gap-0.5">
                {section.items.map((item) => {
                  const available = isAvailable(item)
                  const Icon = item.icon
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        end={item.path === '/'}
                        onClick={onCloseMobile}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors',
                            isActive
                              ? 'bg-navy-700 text-white shadow-[inset_3px_0_0_var(--color-ok-500)]'
                              : 'hover:bg-white/5 hover:text-white',
                            !available && 'text-navy-300/70',
                          )
                        }
                      >
                        <Icon className="size-[18px] shrink-0" aria-hidden />
                        <span className={cn('truncate', collapsed && 'lg:sr-only')}>{item.label}</span>
                        {!available && (
                          <span className={cn('ml-auto text-[11px] text-navy-300', collapsed && 'lg:hidden')}>
                            Fase {item.phase}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={onToggleCollapsed}
          className="hidden h-11 items-center gap-3 border-t border-navy-700 px-5 text-sm text-navy-300 hover:text-white lg:flex"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          <span className={cn(collapsed && 'sr-only')}>Recolher menu</span>
        </button>
      </aside>
    </>
  )
}
