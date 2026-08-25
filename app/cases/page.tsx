import { CaseDirectory } from "./case-directory";
import { NewCaseForm } from "./new-case-form";
import { listCaseDirectory, listFirmUsers } from "@/modules/cases/store";
import { PageHeader } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const [cases, firmUsers] = await Promise.all([listCaseDirectory(), listFirmUsers()]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Legal context"
        title="Cases"
        description="Every matter with the clients, providers, owners, and contact details outbound calling depends on."
      />
      <NewCaseForm firmUsers={firmUsers} />
      <CaseDirectory cases={cases} />
    </div>
  );
}
