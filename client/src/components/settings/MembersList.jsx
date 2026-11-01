import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useMembers } from '../../hooks/useMembers.js';
import { formatDate } from '../../utils/format.js';

const ROLE_STYLES = {
  owner: 'bg-indigo-50 text-indigo-700',
  admin: 'bg-sky-50 text-sky-700',
  member: 'bg-slate-100 text-slate-700',
};

function Badge({ className, children }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${className}`}>
      {children}
    </span>
  );
}

export default function MembersList() {
  const { user } = useAuth();
  const { status, members, error, reload } = useMembers();

  if (status === 'loading') {
    return (
      <p role="status" className="text-sm text-slate-500">
        Loading team&hellip;
      </p>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-slate-100" aria-label="Team members">
        {members.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {member.name}
                {member.id === user.id && (
                  <span className="ml-2 text-xs text-slate-500">(you)</span>
                )}
              </p>
              <p className="truncate text-sm text-slate-500">{member.email}</p>
              {member.lastLoginAt && (
                <p className="mt-0.5 text-xs text-slate-400">
                  Last sign-in {formatDate(member.lastLoginAt)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!member.isActive && <Badge className="bg-red-50 text-red-700">Deactivated</Badge>}
              <Badge className={ROLE_STYLES[member.role]}>{member.role}</Badge>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">Inviting teammates is not available yet.</p>
    </>
  );
}
