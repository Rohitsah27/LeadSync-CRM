import MembersList from '../components/settings/MembersList.jsx';
import WorkspaceForm from '../components/settings/WorkspaceForm.jsx';
import Section from '../components/ui/Section.jsx';

export default function Settings() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your workspace and see who has access.</p>
      </div>

      <Section
        title="Workspace"
        description="Your business name, shown in the header and to your team."
      >
        <WorkspaceForm />
      </Section>

      <Section title="Team" description="People with access to this workspace.">
        <MembersList />
      </Section>
    </div>
  );
}
