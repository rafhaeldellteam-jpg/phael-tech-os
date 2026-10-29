export function ConfigMissing({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-xl content-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Configuração necessária</h1>
      <p className="text-muted">
        O Phael Tech OS precisa saber qual projeto Supabase usar. Copie <code>.env.example</code> para{' '}
        <code>.env.local</code>, preencha os valores e reinicie o servidor.
      </p>
      <ul className="list-disc pl-5 text-sm text-danger-600">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </main>
  )
}
