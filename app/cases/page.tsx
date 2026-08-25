import { CaseDirectory } from "./case-directory";
import { NewCaseForm } from "./new-case-form";
import { listCaseDirectory, listFirmUsers } from "@/modules/cases/store";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const [cases, firmUsers] = await Promise.all([listCaseDirectory(), listFirmUsers()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cases</h1>
        <p className="text-sm text-muted">
          Legal context for every matter: clients, providers, owners, and the contact details outbound calling uses.
        </p>
      </div>
      <NewCaseForm firmUsers={firmUsers} />
      <CaseDirectory cases={cases} />
    </div>
  );
}
