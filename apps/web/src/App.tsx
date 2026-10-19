export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-20 text-white">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan-300">
          ReviewLens
        </p>

        <h1 className="mt-4 text-4xl font-bold tracking-tight">
          Evidence-first AI code review
        </h1>

        <p className="mt-4 leading-7 text-slate-300">
          A GitHub App that combines deterministic checks with AI-assisted
          findings, then validates the evidence before posting advisory
          comments.
        </p>

        <div className="mt-8 rounded-xl border border-slate-700 p-4 text-sm text-slate-300">
          Development scaffold. Review functionality is not implemented yet.
        </div>
      </section>
    </main>
  );
}
