import { CaseDirectory } from "./case-directory";
import { listCaseDirectory } from "@/modules/cases/store";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const cases = await listCaseDirectory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cases</h1>
        <p className="text-sm text-muted">
          Legal context for every matter: clients, providers, owners, and the contact details outbound calling uses.
        </p>
      </div>
      <CaseDirectory cases={cases} />
    </div>
  );
}
